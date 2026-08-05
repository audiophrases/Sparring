/* ============================================================
   Sparring Coach — an opponent that plays the crowd.
   Moves come from the Lichess opening explorer while the game is
   still in book; a small local search takes over afterwards.
   ============================================================ */

/* ============================ config ============================ */
const FILES = "abcdefgh";

/* Every rating bucket Lichess exposes, low to high. These are the whole
   difficulty control: the pools you pick are the crowd the coach copies, and
   the coach plays whatever that crowd plays most in the position in front of
   it. Widening the selection buys coverage in a rare line at the cost of a
   looser opponent.

   A bucket is the FLOOR OF A BAND, and the band is keyed on the average of
   the two players' ratings — not either player's own. So 1400 means "games
   where the pair averaged 1400 to 1599", not "games by 1400 players".

   The explorer takes the number, parses it, and snaps it to whichever band
   contains it (RatingGroup::from_str -> select_avg), so it accepts anything
   and there is no such thing as an invalid value — only values that collapse
   onto a band you already have. Everything below 1000 is one single band, so
   600 and 800 would both land on it; it is offered once here as "<1000".
   At the top, select_avg has no branch that returns the 2800 group: every
   average of 2800 or more falls through to the last one. So 2800 and 3200
   are the same band too, and it is offered once as "2800+". */
const BUCKETS = [0,1000,1200,1400,1600,1800,2000,2200,2500,2800];
const bandTop  = v => BUCKETS[BUCKETS.indexOf(v) + 1] || null;   // null = open ended
const bandLabel = v => v === 0 ? "<1000" : bandTop(v) ? String(v) : v + "+";
const bandRange = v => {
  const t = bandTop(v);
  return t ? v + "–" + (t - 1) : v + " and up";
};
const bandMid = v => { const t = bandTop(v); return t ? (v + t) / 2 : v + 200; };
const DEFAULT_POOLS = [1000,1200,1400,1600];
const SPEEDS = "blitz,rapid,classical";
const THIN = 300;          // total games below which the panel suggests widening

/* Variety: which replies besides the main line the coach is allowed to play.
   A move qualifies on three counts at once, because any one of them alone
   admits junk — a move can be 30% of a position that only has six games in
   it, or be the second most played and still be a hundredth as common as the
   main line. Past the fourth most played there is nothing left worth calling
   a human choice at these sample sizes. */
const VARIETY = {
  take:        4,     // never look past the fourth most played move
  minShare: 0.08,     // at least this share of every game in the position
  minRatio: 0.12,     // and not dwarfed by the main line
  minGames:   20      // on a sample big enough to mean anything
};
/* On minRatio: share does nearly all the work, because the two are linked —
   a move holding 8% of a position cannot be less than about a tenth as common
   as the main line. It was set at 0.25 first, which quietly made the toggle
   do nothing whenever one move led: against a 72% main line no second choice
   can reach a quarter of it, so a reply played in one game out of eight was
   still thrown away. It is a backstop now, not the filter. */

/* ------------------------- piece set -------------------------
   The classic Cburnett vectors, inlined so the board renders with
   no network request and stays crisp at every board size. */
const SVG_OPEN = '<svg class="pc" viewBox="0 0 45 45" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">';
const PIECE_SVG = {
  wk: SVG_OPEN +
    '<g fill="none" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M22.5 11.63V6M20 8h5" stroke-linejoin="miter"/>' +
    '<path d="M22.5 25s4.5-7.5 3-10.5c0 0-1-2.5-3-2.5s-3 2.5-3 2.5c-1.5 3 3 10.5 3 10.5" fill="#fff" stroke-linecap="butt" stroke-linejoin="miter"/>' +
    '<path d="M11.5 37c5.5 3.5 15.5 3.5 21 0v-7s9-4.5 6-10.5c-4-6.5-13.5-3.5-16 4V27v-3.5c-3.5-7.5-13-10.5-16-4-3 6 5 10 5 10V37z" fill="#fff"/>' +
    '<path d="M11.5 30c5.5-3 15.5-3 21 0m-21 3.5c5.5-3 15.5-3 21 0m-21 3.5c5.5-3 15.5-3 21 0"/>' +
    '</g></svg>',
  bk: SVG_OPEN +
    '<g fill="none" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M22.5 11.63V6" stroke-linejoin="miter"/>' +
    '<path d="M22.5 25s4.5-7.5 3-10.5c0 0-1-2.5-3-2.5s-3 2.5-3 2.5c-1.5 3 3 10.5 3 10.5" fill="#000" stroke-linecap="butt" stroke-linejoin="miter"/>' +
    '<path d="M11.5 37c5.5 3.5 15.5 3.5 21 0v-7s9-4.5 6-10.5c-4-6.5-13.5-3.5-16 4V27v-3.5c-3.5-7.5-13-10.5-16-4-3 6 5 10 5 10V37z" fill="#000"/>' +
    '<path d="M20 8h5" stroke-linejoin="miter"/>' +
    '<path d="M32 29.5s8.5-4 6.03-9.65C34.15 14 25 18 22.5 24.5l.01 2.1-.01-2.1C20 18 10.85 14 6.97 19.85c-2.47 5.65 4.03 9.65 4.03 9.65" stroke="#fff"/>' +
    '<path d="M11.5 30c5.5-3 15.5-3 21 0m-21 3.5c5.5-3 15.5-3 21 0m-21 3.5c5.5-3 15.5-3 21 0" stroke="#fff"/>' +
    '</g></svg>',
  wq: SVG_OPEN +
    '<g fill="#fff" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M8 12a2 2 0 1 1-4 0 2 2 0 1 1 4 0zM24.5 7.5a2 2 0 1 1-4 0 2 2 0 1 1 4 0zM41 12a2 2 0 1 1-4 0 2 2 0 1 1 4 0zM16 8.5a2 2 0 1 1-4 0 2 2 0 1 1 4 0zM33 9a2 2 0 1 1-4 0 2 2 0 1 1 4 0z"/>' +
    '<path d="M9 26c8.5-1.5 21-1.5 27 0l2-12-7 11V11l-5.5 13.5-3-15-3 15L14 11v14L7 14l2 12z" stroke-linecap="butt"/>' +
    '<path d="M9 26c0 2 1.5 2 2.5 4 1 1.5 1 1 .5 3.5-1.5 1-1.5 2.5-1.5 2.5-1.5 1.5.5 2.5.5 2.5 6.5 1 16.5 1 23 0 0 0 1.5-1 0-2.5 0 0 .5-1.5-1-2.5-.5-2.5-.5-2 .5-3.5 1-2 2.5-2 2.5-4-8.5-1.5-18.5-1.5-27 0z" stroke-linecap="butt"/>' +
    '<path d="M11 38.5a35 35 1 0 0 23 0" fill="none" stroke-linecap="butt"/>' +
    '<path d="M11 29a35 35 1 0 1 23 0M12.5 31.5h20M11.5 34.5a35 35 1 0 0 22 0M10.5 37.5a35 35 1 0 0 24 0" fill="none"/>' +
    '</g></svg>',
  bq: SVG_OPEN +
    '<g fill="#000" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<g stroke="none">' +
    '<circle cx="6" cy="12" r="2.75"/><circle cx="14" cy="9" r="2.75"/><circle cx="22.5" cy="8" r="2.75"/>' +
    '<circle cx="31" cy="9" r="2.75"/><circle cx="39" cy="12" r="2.75"/></g>' +
    '<path d="M9 26c8.5-1.5 21-1.5 27 0l2.5-12.5L31 25l-.3-14.1-5.2 13.6-3-14.5-3 14.5-5.2-13.6L14 25 6.5 13.5 9 26z" stroke-linecap="butt"/>' +
    '<path d="M9 26c0 2 1.5 2 2.5 4 1 1.5 1 1 .5 3.5-1.5 1-1.5 2.5-1.5 2.5-1.5 1.5.5 2.5.5 2.5 6.5 1 16.5 1 23 0 0 0 1.5-1 0-2.5 0 0 .5-1.5-1-2.5-.5-2.5-.5-2 .5-3.5 1-2 2.5-2 2.5-4-8.5-1.5-18.5-1.5-27 0z" stroke-linecap="butt"/>' +
    '<path d="M11 38.5a35 35 1 0 0 23 0" fill="none" stroke-linecap="butt"/>' +
    '<path d="M11 29a35 35 1 0 1 23 0" fill="none"/>' +
    '<path d="M12.5 31.5h20M11.5 34.5a35 35 1 0 0 22 0M10.5 37.5a35 35 1 0 0 24 0" fill="none" stroke="#fff"/>' +
    '</g></svg>',
  wr: SVG_OPEN +
    '<g fill="#fff" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M9 39h27v-3H9v3zM12 36v-4h21v4H12zM11 14V9h4v2h5V9h5v2h5V9h4v5" stroke-linecap="butt"/>' +
    '<path d="M34 14l-3 3H14l-3-3"/>' +
    '<path d="M31 17v12.5H14V17" stroke-linecap="butt" stroke-linejoin="miter"/>' +
    '<path d="M31 29.5l1.5 2.5h-20l1.5-2.5"/>' +
    '<path d="M11 14h23" fill="none" stroke-linejoin="miter"/>' +
    '</g></svg>',
  br: SVG_OPEN +
    '<g fill="#000" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M9 39h27v-3H9v3zM12.5 32l1.5-2.5h17l1.5 2.5h-20zM12 36v-4h21v4H12z" stroke-linecap="butt"/>' +
    '<path d="M14 29.5v-13h17v13H14z" stroke-linecap="butt" stroke-linejoin="miter"/>' +
    '<path d="M14 16.5L11 14h23l-3 2.5H14zM11 14V9h4v2h5V9h5v2h5V9h4v5H11z" stroke-linecap="butt"/>' +
    '<path d="M12 35.5h21M13 31.5h19M14 29.5h17M14 16.5h17M11 14h23" fill="none" stroke="#fff" stroke-width="1" stroke-linejoin="miter"/>' +
    '</g></svg>',
  wb: SVG_OPEN +
    '<g fill="none" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<g fill="#fff" stroke-linecap="butt">' +
    '<path d="M9 36c3.39-.97 10.11.43 13.5-2 3.39 2.43 10.11 1.03 13.5 2 0 0 1.65.54 3 2-.68.97-1.65.99-3 .5-3.39-.97-10.11.46-13.5-1-3.39 1.46-10.11.03-13.5 1-1.354.49-2.323.47-3-.5 1.354-1.94 3-2 3-2z"/>' +
    '<path d="M15 32c2.5 2.5 12.5 2.5 15 0 .5-1.5 0-2 0-2 0-2.5-2.5-4-2.5-4 5.5-1.5 6-11.5-5-15.5-11 4-10.5 14-5 15.5 0 0-2.5 1.5-2.5 4 0 0-.5.5 0 2z"/>' +
    '<path d="M25 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 1 1 5 0z"/></g>' +
    '<path d="M17.5 26h10M15 30h15m-7.5-14.5v5M20 18h5" stroke-linejoin="miter"/>' +
    '</g></svg>',
  bb: SVG_OPEN +
    '<g fill="none" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<g fill="#000" stroke-linecap="butt">' +
    '<path d="M9 36c3.39-.97 10.11.43 13.5-2 3.39 2.43 10.11 1.03 13.5 2 0 0 1.65.54 3 2-.68.97-1.65.99-3 .5-3.39-.97-10.11.46-13.5-1-3.39 1.46-10.11.03-13.5 1-1.354.49-2.323.47-3-.5 1.354-1.94 3-2 3-2z"/>' +
    '<path d="M15 32c2.5 2.5 12.5 2.5 15 0 .5-1.5 0-2 0-2 0-2.5-2.5-4-2.5-4 5.5-1.5 6-11.5-5-15.5-11 4-10.5 14-5 15.5 0 0-2.5 1.5-2.5 4 0 0-.5.5 0 2z"/>' +
    '<path d="M25 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 1 1 5 0z"/></g>' +
    '<path d="M17.5 26h10M15 30h15m-7.5-14.5v5M20 18h5" stroke="#fff" stroke-linejoin="miter"/>' +
    '</g></svg>',
  wn: SVG_OPEN +
    '<g fill="none" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M22 10c10.5.5 16.5 8 16 29H15c0-9 10-6.5 8-21" fill="#fff"/>' +
    '<path d="M24 18c.38 2.91-5.55 7.37-8 9-3 2-2.82 4.34-5 4-1.042-.94 1.41-3.04 0-3-1 0 .19 1.23-1 2-1 0-4.003 1-4-4 0-2 6-12 6-12s1.89-1.9 2-3.5c-.73-.994-.5-2-.5-3 1-1 3 2.5 3 2.5h2s.78-1.992 2.5-3c1 0 1 3 1 3" fill="#fff"/>' +
    '<path d="M9.5 25.5a.5.5 0 1 1-1 0 .5.5 0 1 1 1 0zM14.933 15.75a.5 1.5 30 1 1-.866-.5.5 1.5 30 1 1 .866.5z" fill="#000" stroke="#000"/>' +
    '</g></svg>',
  bn: SVG_OPEN +
    '<g fill="none" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M22 10c10.5.5 16.5 8 16 29H15c0-9 10-6.5 8-21" fill="#000"/>' +
    '<path d="M24 18c.38 2.91-5.55 7.37-8 9-3 2-2.82 4.34-5 4-1.042-.94 1.41-3.04 0-3-1 0 .19 1.23-1 2-1 0-4.003 1-4-4 0-2 6-12 6-12s1.89-1.9 2-3.5c-.73-.994-.5-2-.5-3 1-1 3 2.5 3 2.5h2s.78-1.992 2.5-3c1 0 1 3 1 3" fill="#000"/>' +
    '<path d="M9.5 25.5a.5.5 0 1 1-1 0 .5.5 0 1 1 1 0zM14.933 15.75a.5 1.5 30 1 1-.866-.5.5 1.5 30 1 1 .866.5z" fill="#fff" stroke="#fff"/>' +
    '<path d="M24.55 10.4l-.45 1.45.5.15c3.15 1 5.65 2.49 7.9 6.75S35.75 29.06 35.25 39l-.05.5h2.25l.05-.5c.5-10.06-.88-16.85-3.25-21.34-2.37-4.49-5.79-6.64-9.19-7.16l-.51-.1z" fill="#fff" stroke="none"/>' +
    '</g></svg>',
  wp: SVG_OPEN +
    '<path d="M22.5 9c-2.21 0-4 1.79-4 4 0 .89.29 1.71.78 2.38C17.33 16.5 16 18.59 16 21c0 2.03.94 3.84 2.41 5.03-3 1.06-7.41 5.55-7.41 13.47h23c0-7.92-4.41-12.41-7.41-13.47C27.06 24.84 28 23.03 28 21c0-2.41-1.33-4.5-3.28-5.62.49-.67.78-1.49.78-2.38 0-2.21-1.79-4-4-4z" ' +
    'fill="#fff" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="miter"/></svg>',
  bp: SVG_OPEN +
    '<path d="M22.5 9c-2.21 0-4 1.79-4 4 0 .89.29 1.71.78 2.38C17.33 16.5 16 18.59 16 21c0 2.03.94 3.84 2.41 5.03-3 1.06-7.41 5.55-7.41 13.47h23c0-7.92-4.41-12.41-7.41-13.47C27.06 24.84 28 23.03 28 21c0-2.41-1.33-4.5-3.28-5.62.49-.67.78-1.49.78-2.38 0-2.21-1.79-4-4-4z" ' +
    'fill="#000" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="miter"/></svg>'
};

/* offline fallback names, keyed by SAN sequence */
const LOCAL_ECO = {
"e4":["B00","King's Pawn Game"],"d4":["A40","Queen's Pawn Game"],"c4":["A10","English Opening"],
"Nf3":["A04","Zukertort Opening"],"g3":["A00","Benko / Hungarian Opening"],"b3":["A01","Nimzo-Larsen Attack"],"f4":["A02","Bird's Opening"],
"e4 e5":["C20","King's Pawn Game"],"e4 c5":["B20","Sicilian Defence"],"e4 e6":["C00","French Defence"],
"e4 c6":["B10","Caro-Kann Defence"],"e4 d5":["B01","Scandinavian Defence"],"e4 Nf6":["B02","Alekhine's Defence"],
"e4 d6":["B07","Pirc Defence"],"e4 g6":["B06","Modern Defence"],"e4 Nc6":["B00","Nimzowitsch Defence"],
"e4 e5 Nf3":["C40","King's Knight Opening"],"e4 e5 Nf3 Nc6":["C44","King's Knight Opening"],
"e4 e5 Nf3 Nc6 Bb5":["C60","Ruy Lopez"],"e4 e5 Nf3 Nc6 Bb5 a6":["C68","Ruy Lopez: Morphy Defence"],
"e4 e5 Nf3 Nc6 Bb5 a6 Ba4":["C70","Ruy Lopez: Morphy Defence"],
"e4 e5 Nf3 Nc6 Bb5 a6 Bxc6":["C68","Ruy Lopez: Exchange Variation"],
"e4 e5 Nf3 Nc6 Bb5 Nf6":["C65","Ruy Lopez: Berlin Defence"],
"e4 e5 Nf3 Nc6 Bc4":["C50","Italian Game"],"e4 e5 Nf3 Nc6 Bc4 Bc5":["C50","Italian Game: Giuoco Piano"],
"e4 e5 Nf3 Nc6 Bc4 Nf6":["C55","Italian Game: Two Knights Defence"],
"e4 e5 Nf3 Nc6 d4":["C44","Scotch Game"],"e4 e5 Nf3 Nc6 d4 exd4 Nxd4":["C45","Scotch Game"],
"e4 e5 Nf3 Nc6 Nc3":["C46","Three Knights Opening"],"e4 e5 Nf3 Nc6 Nc3 Nf6":["C46","Four Knights Game"],
"e4 e5 Nf3 d6":["C41","Philidor Defence"],"e4 e5 Nf3 Nf6":["C42","Petrov's Defence"],
"e4 e5 f4":["C30","King's Gambit"],"e4 e5 Bc4":["C23","Bishop's Opening"],"e4 e5 Nc3":["C25","Vienna Game"],
"e4 c5 Nf3":["B27","Sicilian Defence"],"e4 c5 Nf3 d6":["B50","Sicilian Defence"],
"e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3":["B54","Sicilian: Open"],
"e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6":["B90","Sicilian: Najdorf Variation"],
"e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 Nc6":["B56","Sicilian: Classical Variation"],
"e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6":["B70","Sicilian: Dragon Variation"],
"e4 c5 Nf3 e6":["B40","Sicilian Defence"],"e4 c5 Nf3 Nc6":["B30","Sicilian: Old Sicilian"],
"e4 c5 Nf3 Nc6 Bb5":["B30","Sicilian: Rossolimo Attack"],"e4 c5 Nf3 d6 Bb5+":["B51","Sicilian: Moscow Variation"],
"e4 c5 c3":["B22","Sicilian: Alapin Variation"],"e4 c5 Nc3":["B23","Sicilian: Closed"],
"e4 c5 d4":["B21","Sicilian: Smith-Morra Gambit"],
"e4 e6 d4":["C00","French Defence"],"e4 e6 d4 d5":["C01","French Defence"],
"e4 e6 d4 d5 Nc3":["C10","French: Paulsen Variation"],"e4 e6 d4 d5 Nc3 Bb4":["C15","French: Winawer Variation"],
"e4 e6 d4 d5 Nc3 Nf6":["C11","French: Classical Variation"],"e4 e6 d4 d5 e5":["C02","French: Advance Variation"],
"e4 e6 d4 d5 exd5":["C01","French: Exchange Variation"],"e4 e6 d4 d5 Nd2":["C03","French: Tarrasch Variation"],
"e4 c6 d4 d5":["B12","Caro-Kann Defence"],"e4 c6 d4 d5 Nc3":["B15","Caro-Kann: Main Line"],
"e4 c6 d4 d5 e5":["B12","Caro-Kann: Advance Variation"],"e4 c6 d4 d5 exd5":["B13","Caro-Kann: Exchange Variation"],
"d4 d5":["D00","Queen's Pawn Game"],"d4 Nf6":["A45","Indian Defence"],"d4 f5":["A80","Dutch Defence"],
"d4 d5 c4":["D06","Queen's Gambit"],"d4 d5 c4 e6":["D30","Queen's Gambit Declined"],
"d4 d5 c4 c6":["D10","Slav Defence"],"d4 d5 c4 dxc4":["D20","Queen's Gambit Accepted"],
"d4 d5 c4 e6 Nc3 Nf6":["D35","Queen's Gambit Declined"],"d4 d5 c4 c6 Nf3 Nf6 Nc3 dxc4":["D15","Slav: Main Line"],
"d4 d5 c4 e6 Nf3 Nf6 Nc3 c6":["D43","Semi-Slav Defence"],"d4 d5 Nf3":["D02","Queen's Pawn Game"],
"d4 d5 Bf4":["D00","London System"],"d4 Nf6 Bf4":["A45","London System"],"d4 Nf6 Nf3 d5 Bf4":["D02","London System"],
"d4 Nf6 c4":["A50","Indian Defence"],"d4 Nf6 c4 e6":["E00","Indian: East Indian"],
"d4 Nf6 c4 e6 Nc3 Bb4":["E20","Nimzo-Indian Defence"],"d4 Nf6 c4 e6 Nf3 b6":["E12","Queen's Indian Defence"],
"d4 Nf6 c4 e6 g3":["E00","Catalan Opening"],"d4 Nf6 c4 g6":["E60","King's Indian Defence"],
"d4 Nf6 c4 g6 Nc3 Bg7 e4 d6":["E70","King's Indian Defence"],"d4 Nf6 c4 g6 Nc3 d5":["D80","Grünfeld Defence"],
"d4 Nf6 c4 c5":["A56","Benoni Defence"],"d4 Nf6 c4 e5":["A43","Englund / Budapest"],
"d4 Nf6 c4 e6 Nc3 Bb4 e3":["E40","Nimzo-Indian: Rubinstein"],
"c4 e5":["A20","English: Reversed Sicilian"],"c4 c5":["A30","English: Symmetrical"],
"c4 Nf6":["A15","English: Anglo-Indian"],"c4 e6":["A13","English Opening"],
"Nf3 d5 g3":["A07","King's Indian Attack"],"e4 e5 Nf3 Nc6 Bc4 Bc5 b4":["C51","Evans Gambit"],
"e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5":["C57","Two Knights: Fried Liver Attack"]
};

/* ============================ state ============================ */
let game = new Chess();
/* Your side and the side the board is drawn from are the same fact: the
   colour at the bottom is the one you play, and the coach has the other.
   Flipping is therefore not a view setting — it hands your side over. */
let userColor = "w";

let book = null;          // explorer payload for the current position
let lastName = null, lastEco = null, bookPlies = 0, outOfBook = false;
let sel = null, legalTargets = [], busy = false, panelOpen = true;
let coachMode = true;  // false = free play, you move both sides
let pending = null;       // promotion pending {from,to,color}
let pools = [];           // selected Lichess rating buckets
let variety = false;      // false = the coach always plays the most popular reply
let showBest = false;     // the engine's two best moves, under the bar
/* Review: the board shows an earlier position while `game` stays at the live
   one, so stepping back and forth costs nothing and never rewrites the game.
   reviewPly is the number of plies shown; null means we are on the live move. */
let reviewPly = null, reviewGame = null;
let apiDown = false;
let token = "";
try { token = localStorage.getItem("lichessToken") || ""; } catch(e){}

const $ = id => document.getElementById(id);

/* ============================ board ============================ */
const boardEl = $("board");
const wrapEl = document.querySelector(".wrap");
const cells = [];
for (let i = 0; i < 64; i++) {
  const d = document.createElement("div");
  d.className = "sq";
  d.tabIndex = 0;
  d.addEventListener("click", () => onSquare(i));
  d.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSquare(i); } });
  boardEl.appendChild(d);
  cells.push(d);
}

/* Sizing is done here rather than with `aspect-ratio` and 1fr tracks, because
   a fractional track leaves the browser rounding each square independently:
   that is what draws hairlines between squares and makes some files a pixel
   wider than others. Choosing a multiple of 8 makes every track a whole
   number of pixels, so the eight columns are identical by construction. */
const MAX_BOARD = 720, MIN_BOARD = 192;
/* What the board may not grow into. Side by side with the panel, that is the
   header above it and the eval bar below — 14 of body padding, 43 of header,
   16 of its margin, then the bar's 10 + 30, and 7 of slack. Stacked, the move
   list and the controls sit under the board instead of beside it, so the old
   roomier reserve stays and that layout comes out unchanged. */
const CHROME_WIDE = 120, CHROME_STACKED = 180;
/* the panel's width and the column gap are declared in the stylesheet; read
   them back rather than repeating the numbers here, where they could drift */
const cssPx = n => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(n)) || 0;
/* the exact complement of the stylesheet's own breakpoint, so the two can
   never disagree about which layout is on screen */
const narrow = window.matchMedia("(max-width:860px)");
let boardSize = 0;
function sizeBoard(){
  /* Measured off the body, which is the widest thing in the page that the
     board does not size: the wrap and the board's own column are both derived
     from --board now, so measuring either would be circular, and the viewport
     itself reports the width the reserved scrollbar gutter has already taken. */
  const pad = getComputedStyle(document.body);
  const room = document.body.clientWidth - parseFloat(pad.paddingLeft) - parseFloat(pad.paddingRight);
  const beside = (narrow.matches || !panelOpen) ? 0 : cssPx("--panelw") + cssPx("--colgap");
  const fitsHeight = Math.max(280, window.innerHeight - (narrow.matches ? CHROME_STACKED : CHROME_WIDE));
  const raw = Math.min(room - beside, MAX_BOARD, fitsHeight);
  const size = Math.max(MIN_BOARD, Math.floor(raw / 8) * 8);
  if (size === boardSize) return;
  boardSize = size;
  document.documentElement.style.setProperty("--board", size + "px");
}
sizeBoard();
window.addEventListener("resize", sizeBoard);
/* the page grows and shrinks with --board, so watching it settles in one pass:
   the second call finds the same size and stops */
if (window.ResizeObserver) new ResizeObserver(sizeBoard).observe(document.documentElement);

function sqName(i){
  let r = Math.floor(i/8), f = i%8;
  if (userColor === "b"){ r = 7-r; f = 7-f; }
  return FILES[f] + (8-r);
}
function draw(){
  const view = reviewGame || game;
  /* Both halves of the last exchange are lit, the older one fainter, so the
     reply always has its provocation still on the board. Taken from history
     rather than a running "last move" so review shows the two that led to
     whatever position is on screen. */
  const shown = reviewPly === null ? game.history().length : reviewPly;
  const hv = verboseHistory();
  const hl = shown > 0 ? hv[shown-1] : null;
  const hl2 = shown > 1 ? hv[shown-2] : null;
  const b = view.board();
  const kingSq = view.in_check() ? findKing(view.turn(), view) : null;
  for (let i = 0; i < 64; i++){
    const name = sqName(i);
    const f = FILES.indexOf(name[0]), r = 8 - parseInt(name[1]);
    const p = b[r][f];
    const c = cells[i];
    c.className = "sq " + ((r+f) % 2 === 0 ? "l" : "d");
    if (hl2 && (name === hl2.from || name === hl2.to)) c.classList.add("prev");
    if (hl && (name === hl.from || name === hl.to)) c.classList.add("last");
    if (sel === name) c.classList.add("sel");
    if (kingSq === name) c.classList.add("chk");
    let html = "";
    if (p) html += PIECE_SVG[p.color + p.type];
    if (legalTargets.includes(name)) html += p ? '<span class="ring"></span>' : '<span class="dot"></span>';
    const dr = Math.floor(i/8), df = i%8;
    if (dr === 7) html += '<span class="co f">' + name[0] + '</span>';
    if (df === 0) html += '<span class="co r">' + name[1] + '</span>';
    c.innerHTML = html;
  }
  renderBest();          // the arrows are drawn over this board, so they follow it
}
function findKing(color, g){
  const b = (g || game).board();
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++){
    const p = b[r][f];
    if (p && p.type === "k" && p.color === color) return FILES[f] + (8-r);
  }
  return null;
}

/* ============================ review ============================
   Arrow keys walk the game without touching it. Left steps back, right
   steps forward, and arriving at the final ply drops you back onto the
   live game — so there is no separate "resume" to remember. */
function gotoPly(n){
  const h = game.history({verbose:true});
  n = Math.max(0, Math.min(h.length, n));
  if (n === h.length){
    if (exitReview()){
      draw(); renderMoves(); syncEvalBar(); renderRibbon(); renderCands(); reportViewedMove();
      /* rejoining is the only moment a coach turn left waiting — from toggling
         the coach on mid-review — can be handed back to it */
      if (coachMode && !busy && !game.game_over() && game.turn() !== userColor) step();
    }
    return;
  }
  const g = new Chess();
  for (let i = 0; i < n; i++) g.move(h[i].san);
  reviewPly = n; reviewGame = g;
  sel = null; legalTargets = [];
  /* no announcement — every panel simply describes the position now shown */
  draw(); renderMoves(); syncEvalBar(); renderRibbon(); renderCands(); reportViewedMove();
  ensureViewBook();
}
function exitReview(){
  if (reviewPly === null) return false;
  reviewPly = null; reviewGame = null; viewPending = false;
  return true;
}

/* ---------------- the panels follow the board ----------------
   Whatever position is on show, the candidates panel, ribbon, bar and
   tooltip all describe it. Positions the game has passed through are in
   the explorer cache already, so stepping through them is instant; any
   other position is fetched quietly once the stepping settles. */
let viewSeq = 0, viewPending = false;
function displayBook(){
  if (reviewPly === null || !reviewGame) return book;
  return cache.get(bookKey(reviewGame.fen())) || null;
}
async function ensureViewBook(){
  const mine = ++viewSeq;
  viewPending = false;
  if (reviewPly === null || apiDown) return;
  const fen = reviewGame.fen();
  if (cache.has(bookKey(fen))) return;
  const fresh = () => mine === viewSeq && reviewPly !== null && reviewGame.fen() === fen;
  viewPending = true;
  await sleep(250);                    // let a run of arrow presses settle
  if (!fresh()) return;
  await lookUp(fen);
  if (!fresh()){ return; }
  viewPending = false;
  renderCands();
}
/* ===================== branching =====================
   Playing from a reviewed position is a take-back: the moves after it never
   happened, and the line you play from there is the game. Nothing is parked
   and nothing is kept in reserve, so there is no second game to get back to
   and no state to announce — what is on the board is all there is.
   `game` is rebuilt rather than unwound because a game is only ever read
   through it: rebuild it and the coach, the explorer and the ratings are all
   working on the new line without being told. */
function branchAt(n){
  const h = game.history();
  const g = new Chess();
  for (let i = 0; i < n; i++) g.move(h[i]);
  game = g;
  /* the per-ply records are this line's memory, so they are cut where the
     line is cut — and the opening goes back to whatever was true at that
     ply, since the named line that followed is no longer part of the game */
  evalByPly = evalByPly.slice(0, n + 1);
  openByPly = openByPly.slice(0, n + 1);
  const rec = openingAt(n);
  lastName = rec ? rec.name : null;
  lastEco = rec ? rec.eco : null;
  bookPlies = rec ? rec.namedAt : 0;
  outOfBook = rec ? rec.out : false;
  evalToken++;                             // abandon any search running for the old line
  vhCache = {len:-1, list:[]};
  book = null;
  hideTip();
  exitReview();
  saveSession();          // the shorter line is the game that gets remembered
}

/* ============================ interaction ============================ */
/* Moves are read from whatever position is on the board. While reviewing that
   is an earlier one, and playing there restarts the game from it — so two
   steps back and a different move is the take-back, without a button for it. */
/* Whichever side is to move in the position on the board can be moved — there
   is no rule to explain because there is no restriction. Playing the coach's
   side asks "what if it had gone this way instead", and since the coach only
   answers when its own colour is to move, it picks its side straight back up
   on the next ply. The board is the whole interface: a piece you can pick up
   is a piece you can move. */
function onSquare(i){
  const view = reviewGame || game;
  if (busy || view.game_over()) return;
  const name = sqName(i);
  if (sel && legalTargets.includes(name)){
    const opts = view.moves({square: sel, verbose: true}).filter(m => m.to === name);
    if (opts.some(m => m.flags.includes("p"))) { pending = {from: sel, to: name, color: view.turn()}; showPromo(); return; }
    commit({from: sel, to: name});
    return;
  }
  const piece = view.get(name);
  if (piece && piece.color === view.turn()){
    sel = name;
    legalTargets = view.moves({square: name, verbose: true}).map(m => m.to);
  } else { sel = null; legalTargets = []; }
  draw();
}
function showPromo(){
  const box = $("promo"); box.innerHTML = ""; box.classList.add("show");
  ["q","r","b","n"].forEach(t => {
    const b = document.createElement("button");
    b.title = {q:"Queen", r:"Rook", b:"Bishop", n:"Knight"}[t];
    b.innerHTML = PIECE_SVG[pending.color + t];
    b.onclick = () => { box.classList.remove("show"); commit({from: pending.from, to: pending.to, promotion: t}); };
    box.appendChild(b);
  });
}
function commit(mv){
  const before = displayBook();        // the book for the position being played from
  if (reviewPly !== null) branchAt(reviewPly);   // the game continues from here
  const m = game.move({from: mv.from, to: mv.to, promotion: mv.promotion || "q"});
  if (!m) { sel = null; legalTargets = []; draw(); return; }
  sel = null; legalTargets = [];
  reportUserMove(m, before);
  saveSession();
  draw(); renderMoves(); updateEval();
  step();
}

/* How popular a move was, given the book of the position it was played from.
   Used both as you play and as you step back over moves already made, so the
   line under the board always belongs to the move that produced the position
   on the board. */
function describeMove(san, prev){
  if (!prev || !prev.moves || !prev.moves.length) return '<b>' + san + '</b>';
  const tot = prev.moves.reduce((s,x) => s + gcount(x), 0);
  const hit = prev.moves.find(x => x.san === san);
  if (!hit) return '<b>' + san + '</b> — <span class="hot">not in the database</span> in these pools.';
  const pct = 100 * gcount(hit) / tot;
  const rank = prev.moves.slice().sort((a,x) => gcount(x)-gcount(a)).findIndex(x => x.san === san) + 1;
  const word = pct > 40 ? "the main choice" : pct > 15 ? "a common choice" : pct > 3 ? "a sideline" : "rare";
  /* quoted against the crowd that actually answered, which is not always the
     one you picked — the explorer reaches past your pools when it has to */
  return '<b>' + san + '</b> — ' + word + ': <span class="hot">' + pct.toFixed(1) +
    '%</span> of ' + poolLabel(poolsOf(prev)) + ' players, ' + fmt(gcount(hit)) +
    ' games (#' + rank + ' most played).';
}
function reportUserMove(m, prev){
  const bare = !prev || !prev.moves || !prev.moves.length;
  $("note").innerHTML = bare && outOfBook
    ? '<b>' + m.san + '</b> — past the database. Both sides are on their own now.'
    : describeMove(m.san, prev);
}
/* the same line, for whichever move led to the position now on the board */
function reportViewedMove(){
  const n = viewedPly(), h = game.history();
  if (!n){ $("note").textContent = ""; return; }
  const rec = openByPly[n-1];
  const prev = rec && rec.fen ? cache.get(bookKey(rec.fen)) : null;
  $("note").innerHTML = describeMove(h[n-1], prev);
}

/* ============================ turn loop ============================ */
/* `line` pins the game this turn belongs to. Branching repoints `game`, and
   this function waits on the network twice — without the check a coach reply
   meant for the line you left could land in the one you are now playing. */
async function step(){
  const line = game;
  const stale = () => { if (game === line) return false; busy = false; return true; };
  busy = true;
  book = null; renderCands(); renderRibbon();
  if (game.game_over()){ finish(); busy = false; return; }
  const data = await lookUp(game.fen());
  if (stale()) return;
  book = data;
  absorbOpening(data);
  renderRibbon(); renderCands();
  if (!coachMode || game.turn() === userColor){ busy = false; return; }
  await sleep(260);
  if (stale()) return;
  /* asked again on the way out: F swaps sides, and a reply that was the
     coach's to make when it started thinking may be yours to make now */
  if (!coachMode || game.turn() === userColor){ busy = false; return; }
  const mv = chooseMove(data);
  game.move(mv);
  saveSession();
  exitReview();          // the reply is the point — snap back to it
  draw(); renderMoves(); updateEval();
  if (game.game_over()){ book = null; renderCands(); finish(); busy = false; return; }
  const d2 = await lookUp(game.fen());
  if (stale()) return;
  book = d2; absorbOpening(d2);
  renderRibbon(); renderCands();
  busy = false;
}
function finish(){
  let msg;
  if (game.in_checkmate()) msg = coachMode
    ? (game.turn() === userColor ? "Checkmate — you lost." : "Checkmate — you won.")
    : "Checkmate — " + (game.turn() === "w" ? "Black" : "White") + " wins.";
  else if (game.in_stalemate()) msg = "Stalemate. Draw.";
  else if (game.in_threefold_repetition()) msg = "Draw by repetition.";
  else if (game.insufficient_material()) msg = "Draw — not enough material.";
  else msg = "Draw by the fifty-move rule.";
  $("note").innerHTML = "<b>" + msg + "</b>";   // the result, not advice about it
}

/* The replies the coach will consider: the main line always, plus any of the
   next three that clear all of the bars above. */
function varietySet(moves){
  const ranked = moves.slice().sort((a,b) => gcount(b) - gcount(a));
  const tot = ranked.reduce((s,m) => s + gcount(m), 0);
  const top = gcount(ranked[0]);
  return ranked.slice(0, VARIETY.take).filter((m,i) => i === 0 || (
    gcount(m) >= VARIETY.minGames &&
    gcount(m) >= VARIETY.minRatio * top &&
    gcount(m) / tot >= VARIETY.minShare));
}

/* Pick the opponent's move: the crowd while the book lasts, the engine after.
   With variety off this is a straight argmax — the move the selected pools
   play most often in this exact position. With it on, the choice is drawn
   from the qualifying replies in proportion to how often humans actually pick
   them, so the main line still comes up most; it just stops being the only
   thing that ever happens. */
function chooseMove(data){
  const pool = data && data.moves ? data.moves : [];
  if (!pool.length){ outOfBook = true; return engineMove(engineCfg()); }
  outOfBook = false;
  const keep = varietySet(pool);
  if (!variety || keep.length === 1) return keep[0].san;
  let x = Math.random() * keep.reduce((s,m) => s + gcount(m), 0);
  for (const m of keep){ x -= gcount(m); if (x <= 0) return m.san; }
  return keep[0].san;
}
/* Out of book there is no crowd left to copy, so the fallback engine is
   matched to the pools instead: low buckets get a shallow search that settles
   for any near-best move, high ones get the full three plies. */
function engineCfg(){
  const mean = pools.reduce((a,v) => a + bandMid(v), 0) / pools.length;
  if (mean < 1500) return {depth:1, wild:0.18};
  if (mean < 2000) return {depth:2, wild:0.05};
  return {depth:3, wild:0};
}
const gcount = m => (m.white||0) + (m.draws||0) + (m.black||0);

/* ============================ opening explorer ============================ */
const cache = new Map();
let lastCall = 0;
async function getBook(fen, list){
  const param = poolParam(list);
  const key = fen + "|" + param;
  if (cache.has(key)) return cache.get(key);
  if (apiDown) return null;
  const gap = Date.now() - lastCall;
  if (gap < 900) await sleep(900 - gap);
  const url = "https://explorer.lichess.ovh/lichess?variant=standard&moves=10&topGames=0&recentGames=0"
    + "&speeds=" + SPEEDS + "&ratings=" + param + "&fen=" + encodeURIComponent(fen);
  let why = "";
  for (let attempt = 0; attempt < 2; attempt++){
    try{
      lastCall = Date.now();
      const headers = token ? {Authorization: "Bearer " + token} : {};
      const r = await fetch(url, {headers});
      if (r.status === 429){ why = "rate limited (429)"; await sleep(2600); continue; }
      if (r.status === 401){ why = "401"; apiDown = true; showOffline("401"); return null; }
      if (!r.ok) throw new Error("Lichess replied " + r.status);
      const j = await r.json();
      cache.set(key, j);
      if (apiDown){ apiDown = false; $("offline").hidden = true; }
      return j;
    }catch(e){
      why = (e && e.message) || String(e);
      if (attempt === 1){ apiDown = true; showOffline(why); return null; }
    }
  }
  showOffline(why || "no response"); apiDown = true;
  return null;
}

/* The pools are a difficulty setting, not a search radius. So when a position
   has run past the ones you picked, the sample is widened for that one lookup
   rather than for good, and your chips are left exactly where you put them.
   Widening goes straight to every band in one step rather than creeping out a
   band at a time: the answer is a little less close to your level, but it
   arrives after one extra request instead of up to five, and off the book
   that wait is the coach standing still. Two requests, then the engine.
   What comes back is tagged with the set that answered, so the panel can say
   whose games these are and review can find them again in the cache. */
const reachBy = new Map();            // fen -> the pool set that answered it
const bookKey = fen => fen + "|" + (reachBy.get(fen) || poolParam());
const hasMoves = d => !!(d && d.moves && d.moves.length);
/* the crowd a payload came from, for anything that quotes a percentage of it */
const poolsOf = d => d && d.pools ? d.pools.split(",").map(Number) : null;
async function lookUp(fen){
  let list = pools.slice();
  let data = await getBook(fen, list);
  if (!hasMoves(data) && !apiDown && list.length < BUCKETS.length){
    list = BUCKETS.slice();       // the whole database, in one more request
    data = await getBook(fen, list);
  }
  const param = poolParam(list);
  if (hasMoves(data)){
    data.pools = param;             // rides along with the cached payload
    if (param === poolParam()) reachBy.delete(fen); else reachBy.set(fen, param);
  } else {
    reachBy.delete(fen);
  }
  return data;
}
function showOffline(why){
  const box = $("offline");
  box.hidden = false;
  if (why === "401"){
    box.innerHTML = '<b>Lichess needs a token for the opening explorer.</b> Since March 2026 the explorer '
      + 'rejects anonymous requests. Get a free one — it takes about thirty seconds:<br><br>'
      + '1. Open <a href="https://lichess.org/account/oauth/token/create" target="_blank" '
      + 'style="color:var(--gold)">lichess.org/account/oauth/token/create</a> while logged in.<br>'
      + '2. Give it any description. Leave every scope unticked — reading the explorer needs none.<br>'
      + '3. Submit, copy the token, and paste it into “Lichess token” here.<br><br>'
      + 'It stays in this browser only. Until then the built-in engine plays.';
    return;
  }
  const blocked = /Failed to fetch|NetworkError|Load failed|CSP|not allowed/i.test(why);
  box.innerHTML = blocked
    ? '<b>The database request was blocked, not refused.</b> Preview sandboxes only allow a fixed list of '
      + 'domains. Open index.html directly in your browser instead.'
      + '<br><br><span style="opacity:.7">Reported as: ' + why + '</span>'
    : '<b>Lichess did not answer.</b> ' + why + '. The built-in engine is playing meanwhile — '
      + 'use “Retry database” once the connection is back.';
}
function absorbOpening(data){
  const hist = game.history();
  if (data && data.opening && data.opening.name){
    lastName = data.opening.name; lastEco = data.opening.eco; bookPlies = hist.length;
  } else if (!data){
    for (let n = Math.min(hist.length, 12); n > 0; n--){
      const k = hist.slice(0, n).join(" ");
      if (LOCAL_ECO[k]){ lastEco = LOCAL_ECO[k][0]; lastName = LOCAL_ECO[k][1]; bookPlies = n; break; }
    }
  }
  outOfBook = !(data && data.moves && data.moves.length);
  /* every position the game reaches keeps its opening line, so the ribbon
     can describe whichever ply is being viewed later */
  openByPly[hist.length] = {name: lastName, eco: lastEco, namedAt: bookPlies,
                            out: outOfBook, fen: game.fen()};
}
/* the deepest record at or before a ply is the one that names the position
   there: plies played out of book leave no record of their own */
function openingAt(n){
  for (let i = Math.min(n, openByPly.length - 1); i >= 0; i--){
    if (openByPly[i]) return openByPly[i];
  }
  return null;
}

/* ============================ rendering ============================ */
function renderRibbon(){
  const rb = $("ribbon");
  const n = viewedPly();
  const rec = openingAt(n);
  $("depth").textContent = (rec && rec.out) ? "out of book" : "";
  if (!rec || !rec.name){
    $("eco").textContent = "Opening"; $("oname").textContent = "Starting position";
    $("osub").textContent = n ? "No named line yet." : "Make a move to begin.";
    rb.classList.remove("off");
    return;
  }
  $("eco").textContent = (rec.eco ? rec.eco + " · " : "") + (rec.out ? "last named line" : "in book");
  $("oname").textContent = rec.name;
  $("osub").textContent = rec.out
    ? "Out of book after " + Math.ceil(rec.namedAt/2) + " moves — from here your opponent calculates instead of recalling."
    : "Named at move " + Math.ceil(rec.namedAt/2) + " · " + Math.ceil(n/2) + " played";
  rb.classList.toggle("off", rec.out);
}
function renderCands(){
  const el = $("cands"), lg = $("legend");
  const bk = displayBook();            // the book for the position on the board
  const has = !!(bk && bk.moves && bk.moves.length);
  const moves = has ? bk.moves.slice().sort((a,x) => gcount(x) - gcount(a)) : [];
  const tot = moves.reduce((s,m) => s + gcount(m), 0);
  /* the game count stays on the header even when the rows are hidden — it is
     what tells you the pool has run thin, and it gives nothing away */
  $("poptot").textContent = has ? fmt(tot) + " games" : "";
  if (!panelOpen){ lg.hidden = true; return; }
  /* "no games here" is a claim; only make it once the lookup has actually run */
  const loading = reviewPly === null ? (busy && !bk) : viewPending;
  if (!has && loading){ el.textContent = "Reading the database…"; lg.hidden = true; return; }
  if (!has){
    /* by the time this shows, every band has been asked — lookUp widens on
       its own — so it is a statement about the database, not about your pools */
    el.innerHTML = '<span class="ob">' + (apiDown ? "Database unavailable."
      : "No game in the database has reached this position, in any rating band. "
        + "You are both on your own from here.") + '</span>';
    lg.hidden = true; return;
  }
  const max = gcount(moves[0]);
  /* with variety on, show which replies the coach is actually drawing from */
  const inPlay = variety ? new Set(varietySet(moves).map(m => m.san)) : null;
  el.innerHTML = "";
  /* whose games these are, whenever they are not the crowd you asked for */
  const reached = bk.pools && bk.pools !== poolParam();
  if (reached){
    const d = document.createElement("div");
    d.className = "reach";
    d.innerHTML = "Nobody in your pools has been here, so these are games from <b>"
      + poolLabel(poolsOf(bk)) + "</b>.";
    el.appendChild(d);
  }
  moves.slice(0, 7).forEach(m => {
    const n = gcount(m), pct = 100*n/tot;
    const row = document.createElement("div");
    row.className = "mv" + (inPlay && inPlay.has(m.san) ? " inplay" : "");
    if (inPlay && inPlay.has(m.san)) row.title = "The coach may play this";
    const w = 100*(m.white||0)/n, d = 100*(m.draws||0)/n, b = 100*(m.black||0)/n;
    row.innerHTML =
      '<div class="top"><span class="san">' + m.san + '</span>' +
      '<span class="pct">' + (pct >= 9.95 ? pct.toFixed(0) : pct.toFixed(1)) + '%</span>' +
      '<span class="n">' + fmt(n) + '</span></div>' +
      '<div class="freq" style="width:' + (100*n/max) + '%"></div>' +
      '<div class="bar"><i class="bw" style="width:' + w + '%"></i>' +
      '<i class="bd" style="width:' + d + '%"></i><i class="bb" style="width:' + b + '%"></i></div>';
    el.appendChild(row);
  });
  /* no point offering to widen a sample that was already widened to find this */
  if (tot < THIN && !reached) addWidenHint(el, tot);
  lg.hidden = false;
}
/* Offered only when there is somewhere left to widen to. */
function addWidenHint(el, tot){
  if (pools.length >= BUCKETS.length) return;
  const d = document.createElement("div");
  d.className = "thin";
  d.innerHTML = (tot ? "Only " + fmt(tot) + " games in these pools. " : "")
    + '<button type="button" class="link">Widen the pools</button>';
  d.querySelector("button").onclick = widenPool;
  el.appendChild(d);
}
function renderMoves(){
  const h = game.history();
  syncNav();
  if (!h.length){ $("moves").innerHTML = '<span class="ob">No moves yet.</span>'; return; }
  /* the pair the board is lighting up, so list and board agree in review too */
  const shown = reviewPly === null ? h.length : reviewPly;
  /* the ply under review is marked, so the arrow keys have somewhere to point;
     a rated ply also carries its mark and hangs the tooltip off data-ply */
  const ply = i => {
    const n = i + 1, r = rateMove(n);
    const mark = reviewPly === n ? "cur" : n === shown ? "recent" : n === shown - 1 ? "older" : "";
    const cls = ((mark ? mark + " " : "") + (r ? RATINGS[r.key].cls : "")).trim();
    const g = r ? RATINGS[r.key].glyph : "";
    return '<b data-ply="' + n + '"' + (cls ? ' class="' + cls + '"' : '') + '>'
      + h[i] + (g ? '<i>' + g + '</i>' : '') + '</b>';
  };
  /* the trailing spaces are load-bearing: they are the only places the list is
     allowed to wrap, since each move itself is nowrap. The number stays glued
     to White's move because there is no space between them. */
  let out = "";
  for (let i = 0; i < h.length; i += 2){
    out += '<span class="no">' + (i/2+1) + '.</span>' + ply(i) + " ";
    if (h[i+1]) out += ply(i+1) + " ";
  }
  /* scrolled by hand rather than with scrollIntoView, which also nudges the
     inline axis and the page around it. The move it scrolls to is often the
     one you just tapped, whose tip is about to be re-anchored below — so the
     scroll is claimed, or the scroll handler would take that tip for a reader
     scrolling away from it and close it. Claimed by reading back what the
     assignment actually did rather than what it asked for: a list too short to
     scroll, or already where it wants to be, does not move and fires no event,
     and a claim left standing would swallow the reader's next real scroll. */
  const m = $("moves"); m.innerHTML = out;
  const cur = m.querySelector(".cur");
  const before = m.scrollTop;
  m.scrollTop = cur ? Math.max(0, cur.offsetTop - m.clientHeight / 2) : m.scrollHeight;
  selfScroll = m.scrollTop !== before;
  /* the element the tip was anchored to has just been replaced; re-anchor so a
     rating that lands while you are reading it fills itself in */
  if (tipPly !== null){
    const again = m.querySelector('b[data-ply="' + tipPly + '"]');
    if (again) showTip(again, tipPinned); else hideTip();
  }
}
const fmt = n => n >= 1e6 ? (n/1e6).toFixed(1) + "M" : n >= 1000 ? (n/1000).toFixed(n >= 1e4 ? 0 : 1) + "k" : String(n);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- the tooltip on a move ----------------
   One floating panel reused for every move, so the list stays cheap to
   rebuild. It shows the arithmetic behind the mark rather than only the
   verdict, because the verdict is a two-ply opinion and the numbers let
   you judge it yourself. */
const tipEl = document.createElement("div");
tipEl.className = "tip";
tipEl.hidden = true;
document.body.appendChild(tipEl);

const evalText = e => Math.abs(e.white) >= 9000
  ? (e.white > 0 ? "mate for White" : "mate for Black") : cpLabel(e.white);

function tipHtml(n){
  const h = game.history();
  if (!h[n-1]) return "";
  const r = rateMove(n);
  const who = n % 2 ? "White" : "Black";
  const head = '<div class="t-head"><span class="t-san">' + Math.ceil(n/2)
    + (n % 2 ? "." : "…") + h[n-1] + '</span>';
  if (!r) return head + '<span class="t-rate">Evaluating…</span></div>'
    + '<div class="t-note">The engine is still looking at the position this move led to.</div>';

  const rat = RATINGS[r.key];
  const doomed = r.loss >= 9000;                 // walked into mate; pawns stop meaning anything
  const rows = [];
  rows.push(["Evaluation", evalText(r.a) + " → " + evalText(r.b)]);
  if (r.key === "mate"){
    rows.push(["Result", who + " mates"]);
  } else if (r.key === "forced"){
    rows.push(["Choice", "the only legal move"]);
  } else {
    rows.push(["Cost", doomed ? "allows mate"
      : r.loss < 5 ? "nothing" : (r.loss/100).toFixed(2) + " pawns"]);
    rows.push(["Replies that hold", (r.b.capped ? RES_FULL + "+" : r.res.toFixed(1)) + " of " + RES_FULL]);
    rows.push(["Legal replies", String(r.b.legal)]);
  }
  let note = "";
  if (r.key === "mate") note = "";
  else if (r.key === "forced") note = "Nothing to judge — there was no alternative.";
  else if (doomed) note = "Walks into a forced mate.";
  else if (r.routine) note = "A recapture the position asks for, so it is not marked as clever.";
  else if (r.gave) note = "A won position handed back to roughly level.";
  else if (r.key === "brilliant" || r.key === "great")
    note = "Costs next to nothing and leaves the opponent barely a move that holds.";
  else if (r.trick >= 20 && r.loss >= RATE.inaccuracy)
    note = "Marked down less than the raw cost: it keeps the opponent on a tightrope.";
  else if (r.key === "good") note = "Keeps the balance without forcing the issue.";

  return head + '<span class="t-rate ' + rat.cls + '">' + rat.label + '</span></div>'
    + rows.map(x => '<div class="t-row"><span>' + x[0] + '</span><span>' + x[1] + '</span></div>').join("")
    + (note ? '<div class="t-note">' + note + '</div>' : "");
}
function placeTip(el){
  const r = el.getBoundingClientRect(), t = tipEl.getBoundingClientRect();
  let x = Math.min(r.left, window.innerWidth - t.width - 8);
  let y = r.top - t.height - 8;
  if (y < 8) y = r.bottom + 8;                 // no room above, drop below
  tipEl.style.left = Math.max(8, x) + "px";
  tipEl.style.top = y + "px";
}
/* What the bar is showing, in words and numbers, for the position on show. */
function evalTipHtml(){
  const n = viewedPly(), h = game.history();
  const head = '<div class="t-head"><span class="t-san">'
    + (n ? "After " + Math.ceil(n/2) + (n % 2 ? "." : "…") + h[n-1] : "Starting position")
    + '</span><span class="t-rate">Position</span></div>';
  const e = evalByPly[n];
  if (!e) return head + '<div class="t-note">Still evaluating…</div>';

  const rows = [];
  let note = "";
  if (e.over === "checkmate") rows.push(["Result", "checkmate"]);
  else if (e.over === "draw") rows.push(["Result", "drawn"]);
  else {
    const lead = Math.abs(e.white) < 20 ? "level"
      : (e.white > 0 ? "White" : "Black") + " better";
    rows.push(["Evaluation", evalText(e) + "  ·  " + lead]);
    rows.push(["To move", n % 2 === 0 ? "White" : "Black"]);
    rows.push(["Replies that hold", (e.capped ? RES_FULL + "+" : e.res.toFixed(1)) + " of " + RES_FULL]);
    rows.push(["Legal moves", String(e.legal)]);
    if (!e.capped && e.res < 2)
      note = "The bar is drawn thin because that assessment rests on very few moves.";
  }
  const bk = displayBook();
  if (bk && bk.moves && bk.moves.length){
    const ms = bk.moves.slice().sort((a,x) => gcount(x) - gcount(a));
    const tot = ms.reduce((s,m) => s + gcount(m), 0);
    rows.push(["Games in " + poolLabel(), fmt(tot)]);
    rows.push(["Crowd plays", ms[0].san + "  " + Math.round(100 * gcount(ms[0]) / tot) + "%"]);
  } else if (apiDown) rows.push(["Database", "unavailable"]);
  else rows.push(["Database", "no games here"]);

  return head
    + rows.map(x => '<div class="t-row"><span>' + x[0] + '</span><span>' + x[1] + '</span></div>').join("")
    + (note ? '<div class="t-note">' + note + '</div>' : "");
}

/* Hover shows a tip; a tap pins it, since a touchscreen has no hover to rest
   in. A pinned tip ignores mouseout and is dismissed by tapping its source
   again or anywhere else. One panel serves both the move list and the bar. */
let tipPly = null, tipEval = false, tipPinned = false;
let selfScroll = false;          // the move list scrolled itself, see renderMoves
function openTip(anchor, html, pin){
  if (!html) return;
  tipEl.innerHTML = html;
  tipEl.hidden = false;
  tipPinned = !!pin;
  placeTip(anchor);                             // measured only once it is laid out
}
function showTip(el, pin){
  const n = +el.dataset.ply;
  const html = tipHtml(n);
  if (!html) return;
  tipPly = n; tipEval = false;
  openTip(el, html, pin);
  /* "Evaluating…" is a claim about a search; if none is running, start one, and
     the recordEval that ends it re-renders the list — which re-anchors this
     tip onto its own answer */
  if (!rateMove(n)) fillEvals([n-1, n]);
}
function showEvalTip(pin){
  tipPly = null; tipEval = true;
  openTip($("evalbar"), evalTipHtml(), pin);
}
function hideTip(){ tipEl.hidden = true; tipPly = null; tipEval = false; tipPinned = false; }

$("moves").addEventListener("mouseover", e => {
  const b = e.target.closest("b[data-ply]");
  if (b && !tipPinned) showTip(b, false);
});
$("moves").addEventListener("mouseout", e => {
  if (e.target.closest("b[data-ply]") && !tipPinned) hideTip();
});
/* A move in the list is the position after it, so clicking one goes there —
   the same review the arrow keys do, reached by pointing at it. The tip is
   pinned first and the board moved second: the jump rebuilds the list, and
   re-anchoring the tip onto the element that replaces this one is something
   renderMoves already knows how to do. */
$("moves").addEventListener("click", e => {
  const b = e.target.closest("b[data-ply]");
  if (!b) return;
  const n = +b.dataset.ply;
  /* the click stops here. It would otherwise reach the dismiss-on-click-away
     handler below, which asks whether the click landed inside the move list —
     and by then the jump has rebuilt the list, leaving the element it landed
     on detached from the document and that question unanswerable. */
  e.stopPropagation();
  if (tipPinned && tipPly === n) hideTip();
  else showTip(b, true);
  gotoPly(n);
});
$("evalbar").addEventListener("mouseover", () => { if (!tipPinned) showEvalTip(false); });
$("evalbar").addEventListener("mouseout", () => { if (!tipPinned) hideTip(); });
$("evalbar").addEventListener("click", () => {
  if (tipPinned && tipEval) hideTip(); else showEvalTip(true);
});
$("evalbar").addEventListener("focus", () => showEvalTip(false));
$("evalbar").addEventListener("blur", () => { if (!tipPinned) hideTip(); });
document.addEventListener("click", e => {
  if (tipPinned && !e.target.closest("#moves, #evalbar")) hideTip();
});
/* a tip belongs to the move under it; scrolling the list away from that move
   drops it — unless the list was scrolled by the render that placed it */
$("moves").addEventListener("scroll", () => {
  if (selfScroll){ selfScroll = false; return; }
  hideTip();
});
window.addEventListener("blur", hideTip);

/* ============================ fallback engine ============================ */
const VAL = {p:100, n:320, b:330, r:500, q:900, k:20000};
const PST = {
p:[0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10, 5,5,10,25,25,10,5,5,
   0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5, 5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0],
n:[-50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,0,0,0,-20,-40, -30,0,10,15,15,10,0,-30,
   -30,5,15,20,20,15,5,-30, -30,0,15,20,20,15,0,-30, -30,5,10,15,15,10,5,-30,
   -40,-20,0,5,5,0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50],
b:[-20,-10,-10,-10,-10,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,10,10,5,0,-10,
   -10,5,5,10,10,5,5,-10, -10,0,10,10,10,10,0,-10, -10,10,10,10,10,10,10,-10,
   -10,5,0,0,0,0,5,-10, -20,-10,-10,-10,-10,-10,-10,-20],
r:[0,0,0,0,0,0,0,0, 5,10,10,10,10,10,10,5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5,
   -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, 0,0,0,5,5,0,0,0],
q:[-20,-10,-10,-5,-5,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,5,5,5,0,-10,
   -5,0,5,5,5,5,0,-5, 0,0,5,5,5,5,0,-5, -10,5,5,5,5,5,0,-10,
   -10,0,5,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20],
k:[-30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30, -20,-30,-30,-40,-40,-30,-30,-20, -10,-20,-20,-20,-20,-20,-20,-10,
   20,20,0,0,0,0,20,20, 20,30,10,0,0,10,30,20]
};
function evaluate(g){
  const b = g.board(); let s = 0;
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++){
    const p = b[r][f]; if (!p) continue;
    const idx = p.color === "w" ? r*8+f : (7-r)*8+f;
    const v = VAL[p.type] + PST[p.type][idx];
    s += p.color === "w" ? v : -v;
  }
  return g.turn() === "w" ? s : -s;
}
let nodes = 0;
function quiesce(g, alpha, beta){
  const stand = evaluate(g);
  if (stand >= beta) return beta;
  if (stand > alpha) alpha = stand;
  if (nodes > 90000) return alpha;
  const caps = g.moves({verbose:true}).filter(m => m.flags.includes("c") || m.flags.includes("e"));
  caps.sort((a,x) => (VAL[x.captured]||0) - (VAL[a.captured]||0));
  for (const m of caps){
    nodes++;
    g.move(m);
    const sc = -quiesce(g, -beta, -alpha);
    g.undo();
    if (sc >= beta) return beta;
    if (sc > alpha) alpha = sc;
  }
  return alpha;
}
function negamax(g, depth, alpha, beta){
  if (depth === 0) return quiesce(g, alpha, beta);
  const ms = g.moves({verbose:true});
  if (!ms.length) return g.in_check() ? -90000 - depth : 0;
  ms.sort((a,x) => ((x.captured ? VAL[x.captured] : 0) + (x.promotion ? 800 : 0))
                 - ((a.captured ? VAL[a.captured] : 0) + (a.promotion ? 800 : 0)));
  for (const m of ms){
    if (nodes > 220000) break;
    nodes++;
    g.move(m);
    const sc = -negamax(g, depth-1, -beta, -alpha);
    g.undo();
    if (sc >= beta) return beta;
    if (sc > alpha) alpha = sc;
  }
  return alpha;
}
function engineMove(cfg){
  const ms = game.moves({verbose:true});
  if (cfg.wild && Math.random() < cfg.wild) return ms[Math.floor(Math.random()*ms.length)].san;
  nodes = 0;
  let best = ms[0], bestScore = -Infinity;
  const scored = [];
  for (const m of ms){
    game.move(m);
    const sc = -negamax(game, cfg.depth - 1, -Infinity, Infinity);
    game.undo();
    scored.push({m, sc});
    if (sc > bestScore){ bestScore = sc; best = m; }
  }
  if (cfg.depth <= 2){ // let weaker levels choose among near-best moves
    const band = scored.filter(x => x.sc >= bestScore - (cfg.depth === 1 ? 90 : 35));
    return band[Math.floor(Math.random()*band.length)].m.san;
  }
  return best.san;
}

/* ===================== evaluation bar (async, shallow) =====================
   Two plies deep, plus quiescence — but only on leaves that are actually noisy.
   chess.js 0.10.3 rebuilds every move to disambiguate SAN, so moves() costs
   ~1.3ms, thousands of times more than evaluate(). Calling it at every quiet
   leaf is what would make this search take seconds; skipping it there does not
   cost accuracy, because a leaf only needs captures resolved when the move that
   reached it was itself a capture, a promotion, or a check.                  */
const EVAL_BATCH = 4;      // root moves per slice before yielding to the browser
const RES_MARGIN = 100;    // a move within this of the best still "holds" the position
const RES_FULL   = 4;      // this much resilience draws the bar at full height
const RES_MIN    = 0.2;    // an only-move position still draws a visible sliver
let evalToken = 0;         // cancels a search that a newer move has superseded

/* ===================== move rating =====================
   Two numbers decide a move's mark.

   Loss, in centipawns. A negamax score is relative to the side to move, so
   the value of the move actually played is the negation of the best score in
   the position it led to: loss = bestBefore + bestAfter. Both come straight
   from the full-window first pass of consecutive searches, which is the only
   place accurate per-move numbers exist — the resilience pass clamps refuted
   moves to `best` and runs a window too narrow to separate a mistake from a
   blunder.

   Trickiness, from the resilience the bar already draws: how many replies
   hold the opponent's position. One means a tightrope. That earns a discount
   off the loss, so a move that concedes a little but leaves the opponent one
   path is not marked down like a plain error.

   Everything you might want to retune lives in this block.                */
const RATE = {
  inaccuracy:  50,    // practical loss (cp) for ?!
  mistake:    120,    // for ?
  blunder:    250,    // for ??
  brillLoss:   25,    // !! costs no more than this...
  brillRes:  1.25,    // ...and leaves the opponent about one reply that holds
  greatLoss:   45,
  greatRes:   1.9,
  trick:       60,    // cp forgiven when the opponent is left with nothing
  lostAnyway:-200,    // below this the move is simply losing; no credit for their short list
  minLegal:     4,    // fewer legal replies than this and they were forced, not outplayed
  wonBefore:  150,    // a won position handed back...
  wonAfter:    40     // ...down to about level is a blunder whatever the raw cp
};
const RATINGS = {
  mate:       {glyph:"",   label:"Checkmate",  cls:"r-brill"},   // SAN already carries the #
  forced:     {glyph:"",   label:"Forced",     cls:""},
  brilliant:  {glyph:"!!", label:"Brilliant",  cls:"r-brill"},
  great:      {glyph:"!",  label:"Great move", cls:"r-great"},
  good:       {glyph:"",   label:"Good",       cls:""},
  inaccuracy: {glyph:"?!", label:"Inaccuracy", cls:"r-inacc"},
  mistake:    {glyph:"?",  label:"Mistake",    cls:"r-mist"},
  blunder:    {glyph:"??", label:"Blunder",    cls:"r-blun"}
};
/* one entry per ply reached, index 0 being the starting position */
let evalByPly = [];
/* same shape for the opening line, so the ribbon can name any viewed ply */
let openByPly = [];

const noisier = (a, x) => ((x.captured ? VAL[x.captured] : 0) + (x.promotion ? 800 : 0))
                        - ((a.captured ? VAL[a.captured] : 0) + (a.promotion ? 800 : 0));

/* the reply ply: score every answer to a root move, from the replier's side */
function evalReplies(g, alpha, beta){
  const ms = g.moves({verbose:true});
  if (!ms.length) return g.in_check() ? -90000 : 0;
  ms.sort(noisier);
  for (const m of ms){
    nodes++;
    g.move(m);
    const noisy = m.captured || m.promotion || g.in_check();
    const sc = -(noisy ? quiesce(g, -beta, -alpha) : evaluate(g));
    g.undo();
    if (sc >= beta) return beta;
    if (sc > alpha) alpha = sc;
  }
  return alpha;
}

/* held so a search in progress keeps the bar it last settled on */
let evalPct = 50, evalThinSide = null, evalThick = 1;
function paintEval(pct, label, thinSide, thick, thinking){
  evalPct = Math.max(0, Math.min(100, pct));
  evalThinSide = thinSide; evalThick = thick;
  $("evalw").style.width = evalPct + "%";
  $("evalb").style.width = (100 - evalPct) + "%";
  $("evalw").style.height = 100 * (thinSide === "w" ? thick : 1) + "%";
  $("evalb").style.height = 100 * (thinSide === "b" ? thick : 1) + "%";
  $("evaltxt").textContent = label;
  $("evalbar").classList.toggle("think", !!thinking);
}
/* Centipawns → share of the bar. A plain sigmoid spends almost none of its
   travel where games are actually decided: at 1/(1+e^(-cp/350)) a half-pawn
   edge moved the boundary 3.6% off centre, which is invisible. So the first
   pawn gets a straight run of 18% of the bar each way — a quarter-pawn is
   already 4.5% off centre, readable against the centre tick — and everything
   past it is compressed into the remaining 32%, still approaching the ends
   without ever reaching them. Mate is drawn separately at the extremes. */
function cpToPct(cp){
  const s = Math.sign(cp), a = Math.abs(cp);
  const frac = a <= 100
    ? 0.18 * (a / 100)
    : 0.18 + 0.32 * (1 - Math.exp(-(a - 100) / 420));
  return 50 + s * frac * 100;
}
function cpLabel(cp){
  const p = cp/100;
  return (p >= 0 ? "+" : "-") + Math.abs(p).toFixed(Math.abs(p) >= 10 ? 0 : 1);
}

/* The bar belongs to the position on the board, not to the end of the game.
   Every ply keeps its own search result, so stepping through history repaints
   from the record instead of re-searching — instant, and it means an eval
   landing for the live game cannot yank the bar out from under a review. */
function viewedPly(){ return reviewPly === null ? game.history().length : reviewPly; }
function paintPly(ply){
  const e = evalByPly[ply];
  if (!e){ paintEval(evalPct, "…", evalThinSide, evalThick, true); return; }
  const turn = ply % 2 === 0 ? "w" : "b";        // White starts, so parity is the mover
  if (e.over === "checkmate")
    return paintEval(turn === "w" ? 0 : 100, turn === "w" ? "0–1" : "1–0", null, 1);
  if (e.over === "draw") return paintEval(50, "½–½", null, 1);
  const w = e.white, mate = Math.abs(w) >= 9000;
  const leader = w > 0 ? "w" : w < 0 ? "b" : null;
  paintEval(mate ? (w > 0 ? 100 : 0) : cpToPct(w),
            mate ? (w > 0 ? "#" : "-#") : cpLabel(w),
            leader === turn ? leader : null,          // thin only for the side to move
            Math.min(1, Math.max(RES_MIN, e.res / RES_FULL)));
}
function syncEvalBar(){ paintPly(viewedPly()); renderBest(); }

/* The one search behind everything the engine says: the bar, the rating on a
   played move, and the two best replies. `live` marks the search for the
   position the game is actually at — the only one allowed to paint the bar
   mid-thought, since a review is looking at a ply that already has its answer. */
async function updateEval(){ return runEval(game.history().length, game.fen(), true); }
async function runEval(ply, fen, live){
  const mine = ++evalToken;
  const g = new Chess(fen);

  if (g.game_over()){
    /* a mated side is worth -99000 to itself; a draw is worth nothing to
       either, which is what makes stalemating a won position score as the
       blunder it is */
    const mated = g.in_checkmate();
    recordEval(ply, {                   // recording repaints the bar
      best: mated ? -99000 : 0,
      white: mated ? (g.turn() === "w" ? -99000 : 99000) : 0,
      res: RES_FULL, legal: 0, capped: false,
      over: mated ? "checkmate" : "draw"
    });
    return;
  }

  if (live && reviewPly === null){
    paintEval(evalPct, "…", evalThinSide, evalThick, true);
    renderBest();                       // the old position's answers are not this one's
  }
  await sleep(0);                       // let the move render before we search
  if (mine !== evalToken) return;

  /* order the root by static score after the move: alpha climbs sooner, so the
     reply layer cuts off before it reaches its expensive quiescence leaves */
  const ms = g.moves({verbose:true});
  for (const m of ms){ g.move(m); m._s = -evaluate(g); g.undo(); }
  ms.sort((a, x) => x._s - a._s);
  /* Resilience needs a real score for every move that lands within RES_MARGIN
     of the best one, which ordinary alpha-beta cannot give: a refuted move
     fails low and comes back carrying `best` itself, so a position with one
     saving move would look like a wall of equally good ones. Searching wide
     enough to avoid that costs about nine times the nodes, so it is done in
     two passes instead — a tight one to pin down the best score, then a narrow
     one that only has to separate the contenders from the rest. */
  nodes = 0;
  let best = -Infinity;
  for (let i = 0; i < ms.length; i++){
    g.move(ms[i]);
    ms[i]._v = -evalReplies(g, -Infinity, -best);      // ordinary alpha-beta
    g.undo();
    if (ms[i]._v > best) best = ms[i]._v;
    if (i % EVAL_BATCH === EVAL_BATCH - 1 && i < ms.length - 1){
      const carried = nodes;            // engineMove may reset the shared counter
      await sleep(0);
      if (mine !== evalToken) return;
      nodes = carried;
    }
  }

  /* Second pass over a window only RES_MARGIN wide. Anything below the band
     fails low and scores best-RES_MARGIN, which weighs nothing — exactly the
     answer we needed. Best-first order lets a quiet position stop early. */
  ms.sort((a, x) => x._v - a._v);
  let resilience = 0, capped = false;
  for (let i = 0; i < ms.length; i++){
    if (resilience >= RES_FULL){ capped = true; break; }
    g.move(ms[i]);
    const sc = Math.min(best, -evalReplies(g, -(best + 1), -(best - RES_MARGIN)));
    g.undo();
    resilience += Math.max(0, 1 - (best - sc) / RES_MARGIN);
    if (i % EVAL_BATCH === EVAL_BATCH - 1 && i < ms.length - 1){
      const carried = nodes;
      await sleep(0);
      if (mine !== evalToken) return;
      nodes = carried;
    }
  }
  if (mine !== evalToken) return;   // branching abandoned this search
  const white = g.turn() === "w" ? best : -best;    // negamax is side-to-move relative
  /* Resilience is measured over the moves of the side to move, so it only
     describes an advantage when that side is the one holding it — paintPly
     applies that, along with the label and the width, from the record below.
     ms is sorted best-first by the resilience pass, so ms[0] is this side's
     best reply — kept to spot a plain recapture when rating the move before. */
  /* The top of that same list, kept because it costs nothing: every move here
     was searched to find `best`, so the two that came out ahead are already in
     hand. The squares travel with them, since what they are drawn as is an
     arrow from one to the other. */
  const side = g.turn() === "w" ? 1 : -1;
  recordEval(ply, {best, white, res: resilience, legal: ms.length, capped, over: null,
                   bestTo: ms[0] && ms[0].to, bestCap: !!(ms[0] && /[ce]/.test(ms[0].flags || "")),
                   top: ms.slice(0, 2).map(m => ({san: m.san, cp: side * m._v,
                                                  from: m.from, to: m.to}))});
}

/* ===================== filling in a ply the engine never saw =====================
   The engine only ever looks at the position in front of it, so a ply it never
   reached — one restored from a session older than stored evals, or a record
   dropped as unsound — had a tip that said "Evaluating…" forever, waiting on a
   search nobody had started. Opening that tip starts it. Rating a move needs
   the record on both sides of it, so both are filled, one at a time: each
   search cancels the one before it, and running them together would leave the
   pair permanently incomplete. */
function fenAtPly(n){
  const g = new Chess(), h = game.history();
  for (let i = 0; i < n && i < h.length; i++) g.move(h[i]);
  return g.fen();
}
let backfilling = false;
async function fillEvals(plies){
  if (backfilling) return;
  backfilling = true;
  try {
    for (const k of plies){
      if (k < 0 || k > game.history().length || evalByPly[k]) continue;
      await runEval(k, fenAtPly(k), false);
      if (!evalByPly[k]) break;      // cancelled by a newer search; do not fight it
    }
  } finally {
    backfilling = false;
    /* whatever this cancelled might have been the live position's own search */
    if (!evalByPly[game.history().length]) updateEval();
  }
}

/* The engine's own two answers for the position on the board, on a toggle,
   because a coach that always shows you the move is not sparring. They are
   drawn on the board itself: a move is a thing that goes from one square to
   another, and naming it in a list somewhere makes you find that on the board
   yourself. The overlay is measured in squares — the viewBox is 8 by 8 — so it
   scales with the board and never has to be redrawn for a resize. */
const ARROW = {tail:0.30, tip:0.10, head:0.34, wide:0.20};
function squareCenter(name){
  let f = FILES.indexOf(name[0]), r = 8 - Number(name[1]);
  if (f < 0 || !(r >= 0 && r <= 7)) return null;
  if (userColor === "b"){ r = 7 - r; f = 7 - f; }
  return {x: f + 0.5, y: r + 0.5};
}
function arrowSvg(from, to, cls){
  const a = squareCenter(from), b = squareCenter(to);
  if (!a || !b) return "";
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (!len) return "";
  const ux = dx/len, uy = dy/len;                     // along the move
  const px = -uy, py = ux;                            // across it
  const sx = a.x + ux*ARROW.tail, sy = a.y + uy*ARROW.tail;
  const tx = b.x - ux*ARROW.tip,  ty = b.y - uy*ARROW.tip;
  const bx = tx - ux*ARROW.head,  by = ty - uy*ARROW.head;
  const pt = (x,y) => x.toFixed(3) + "," + y.toFixed(3);
  return '<g class="' + cls + '">'
    + '<line x1="' + sx.toFixed(3) + '" y1="' + sy.toFixed(3)
    + '" x2="' + bx.toFixed(3) + '" y2="' + by.toFixed(3) + '"/>'
    + '<polygon points="' + pt(tx,ty) + " "
    + pt(bx + px*ARROW.wide, by + py*ARROW.wide) + " "
    + pt(bx - px*ARROW.wide, by - py*ARROW.wide) + '"/></g>';
}
function renderBest(){
  const svg = $("arrows");
  svg.innerHTML = "";
  if (!showBest) return;
  const n = viewedPly(), e = evalByPly[n];
  if (!e){
    /* the live ply has a search of its own coming either way; anything earlier
       is a ply the engine never reached, and asking is the only way it will */
    if (n !== game.history().length) fillEvals([n]);
    return;
  }
  if (e.over || !e.top || !e.top.length) return;
  /* records written before the arrows existed name the move without saying
     where it goes, so the square is read back off the position */
  let board = null;
  const squares = m => {
    if (m.from && m.to) return m;
    if (!board) board = new Chess(fenAtPly(n));
    const mv = board.move(m.san);
    if (!mv) return null;
    board.undo();
    return mv;
  };
  /* second first, so the better move is drawn over it where they cross */
  svg.innerHTML = e.top.slice(0, 2).map(squares).map((m, i) =>
    m ? arrowSvg(m.from, m.to, i ? "a2" : "a1") : "").reverse().join("");
}

/* ============================ pools ============================
   Widening trades strength for coverage, which is the trade you want once a
   line stops appearing in the games of the band you picked. The cache key
   carries the pools, so flipping back to a set you have already read costs
   no request. */
/* Both of these describe a pool set — the one you picked by default, or any
   other set when the explorer had to reach past yours to answer. */
function poolParam(list){ return (list || pools).join(","); }
/* The pools are a setting rather than part of a game, so they outlive the
   tab. What comes back out of storage is filtered through BUCKETS instead of
   being trusted: a stale or hand-edited value would otherwise be sent to the
   explorer as a rating band that does not exist. */
const POOLS_KEY = "ratingPools";
function storedPools(){
  let raw = "";
  try { raw = localStorage.getItem(POOLS_KEY) || ""; } catch(e){ return null; }
  /* the empty segments have to go before Number sees them: Number("") is 0,
     and 0 is a real bucket — the one below 1000 — so an empty or trailing
     comma would otherwise read as a deliberate pick of the weakest pool */
  const want = raw.split(",").filter(s => s !== "").map(Number);
  const keep = BUCKETS.filter(v => want.includes(v));
  return keep.length ? keep : null;
}
function rememberPools(){
  try { localStorage.setItem(POOLS_KEY, poolParam()); } catch(e){}
}

/* ===================== the session =====================
   The pools keep their own key; this is everything else that should still be
   true when you come back — which side you are playing, whether the coach and
   variety are on, whether the panel is open, and the game itself as a PGN,
   which is all chess.js needs to be the same game again.
   The two per-ply records travel with it. They are made as the game is played
   and never remade: the engine only ever looks at the position in front of it,
   and the opening line is read off the explorer reply for the position being
   asked about. Left behind, a game picked back up loses every rating mark it
   had earned, and every ply before the one you returned to loses the name of
   the line it was in. */
const SESSION_KEY = "session";
function saveSession(){
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      side: userColor, coach: coachMode, vary: variety, best: showBest,
      panel: panelOpen, pgn: game.pgn(), evals: evalByPly, opens: openByPly
    }));
  } catch(e){}
}
function loadSession(){
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); }
  catch(e){ return null; }
}
/* Evals come back through a sieve. They are read as arithmetic — into the bar,
   into the cost of a move, into the resilience behind its mark — so a record
   from an older shape of this file, or one edited by hand, would surface as a
   NaN drawn on the bar rather than as anything that announces itself. A record
   that is not four sound numbers is dropped, and a dropped ply reads as one
   the engine never reached, which is a state everything here already knows. */
function cleanEvals(raw, plies){
  if (!Array.isArray(raw)) return [];
  const num = v => typeof v === "number" && isFinite(v);
  return raw.slice(0, plies + 1).map(e =>
    e && num(e.best) && num(e.white) && num(e.res) && num(e.legal) ? e : null);
}
/* Openings get the same treatment for the same reason, though what they feed
   is the ribbon rather than arithmetic: a record has to carry the ply its line
   was named at, since the ribbon counts moves from it. */
function cleanOpens(raw, plies){
  if (!Array.isArray(raw)) return [];
  const str = v => v === null || v === undefined || typeof v === "string";
  return raw.slice(0, plies + 1).map(o =>
    o && typeof o === "object" && typeof o.namedAt === "number" && isFinite(o.namedAt)
      && str(o.name) && str(o.eco) && str(o.fen) ? o : null);
}
/* The rating range actually covered, not the list of floors: picking 1000
   through 1600 reaches games averaging up to 1799, and saying "1000–1600"
   would understate it by a whole band. */
function poolLabel(list){
  const use = list || pools;
  const idx = use.map(v => BUCKETS.indexOf(v));
  const run = idx.every((v,i) => i === 0 || v === idx[i-1] + 1);
  if (!run) return use.map(bandLabel).join(" / ");
  const top = bandTop(use[use.length - 1]);
  /* a run that starts at the bottom band has no floor worth naming — saying
     "0–2499" invents a precision the lowest bucket does not have */
  if (!use[0]) return top ? "under " + top : "any rating";
  return top ? use[0] + "–" + (top - 1) : use[0] + "+";
}
function renderChips(){
  const box = $("chips");
  box.innerHTML = "";
  BUCKETS.forEach(v => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip" + (pools.includes(v) ? " on" : "");
    b.textContent = bandLabel(v);
    b.title = "Games whose two players averaged " + bandRange(v);
    b.setAttribute("aria-pressed", String(pools.includes(v)));
    b.onclick = () => setPools(pools.includes(v) ? pools.filter(x => x !== v) : pools.concat(v));
    box.appendChild(b);
  });
}
function setPools(next){
  const sorted = BUCKETS.filter(v => next.includes(v));
  if (!sorted.length) return;                     // never leave the book with nothing to read
  /* every "we had to reach past your pools for this one" decision was made
     against the old set, so none of them survive a new one */
  pools = sorted; rememberPools(); reachBy.clear(); renderChips(); refreshPosition();
}
/* One step out: the band below the lowest and the band above the highest. */
function widerThan(list){
  const idx = list.map(v => BUCKETS.indexOf(v));
  const next = list.slice();
  const lo = Math.min(...idx), hi = Math.max(...idx);
  if (lo > 0) next.push(BUCKETS[lo-1]);
  if (hi < BUCKETS.length - 1) next.push(BUCKETS[hi+1]);
  return BUCKETS.filter(v => next.includes(v));
}
function widenPool(){ setPools(widerThan(pools)); }

/* ===================== rating a played move =====================
   Every position the game has reached leaves a record here, so a move is
   rated from the pair that brackets it. The rating is only as sharp as the
   two-ply search behind it: it knows a piece was dropped, it does not know
   the sacrifice three moves from now was sound. */
function recordEval(ply, data){
  evalByPly[ply] = data;
  saveSession();          // the move was saved before its eval existed
  renderMoves();
  syncEvalBar();
  /* a tip open on the bar was showing "still evaluating"; fill it in */
  if (tipEval && !tipEl.hidden) showEvalTip(tipPinned);
}
/* verbose history is rebuilt move by move inside chess.js, so it is cached
   rather than asked for once per ply per render */
let vhCache = {len:-1, list:[]};
function verboseHistory(){
  const len = game.history().length;
  if (vhCache.len !== len) vhCache = {len, list: game.history({verbose:true})};
  return vhCache.list;
}

function rateMove(n){                        // n = 1-based ply
  const a = evalByPly[n-1], b = evalByPly[n];
  if (!a || !b) return null;
  if (b.over === "checkmate") return {key:"mate", loss:0, res:0, a, b};
  /* With one legal move there was nothing to get wrong. Worth stating
     explicitly: a mate coming into view across the move would otherwise
     charge the whole swing to a player who had no choice. */
  if (a.legal === 1) return {key:"forced", loss:0, res:Math.min(b.res, RES_FULL), a, b};

  /* both scores are relative to whoever is on move in their own position, so
     the played move is worth -b.best to the mover */
  const loss = Math.max(0, a.best + b.best);
  const res  = Math.min(b.res, RES_FULL);
  /* The discount is for keeping the opponent on a tightrope. If the move left
     you clearly worse, their shortage of replies is not your doing — they only
     need the one that wins — so it earns nothing. */
  const moverAfter = -b.best;
  const tricky = moverAfter > RATE.lostAnyway;
  const trick = tricky ? RATE.trick * Math.max(0, (RES_FULL - res) / RES_FULL) : 0;
  const practical = loss - trick;
  const gave = a.best >= RATE.wonBefore && -b.best <= RATE.wonAfter;

  /* Two plies cannot tell a clever move from a capture that simply must be
     answered. Inside an exchange the material has to come back, so exactly
     one reply holds and every trade reads as a tightrope — whether the answer
     retakes on the same square or grabs elsewhere in the sequence. A capture
     answered by a capture is therefore bookkeeping, not brilliance. */
  const mv = verboseHistory()[n-1];
  const routine = !!(mv && /[ce]/.test(mv.flags || "") && b.bestCap);
  const earned = b.legal >= RATE.minLegal && !routine;

  let key;
  if (gave && loss >= RATE.mistake)      key = "blunder";
  else if (practical >= RATE.blunder)    key = "blunder";
  else if (practical >= RATE.mistake)    key = "mistake";
  else if (practical >= RATE.inaccuracy) key = "inaccuracy";
  else if (earned && loss <= RATE.brillLoss && res < RATE.brillRes) key = "brilliant";
  else if (earned && loss <= RATE.greatLoss && res < RATE.greatRes) key = "great";
  else key = "good";
  return {key, loss, res, practical, trick, gave, routine, a, b};
}

/* ============================ controls ============================ */
$("newg").onclick = newGame;

/* Flipping turns the board round and swaps sides with it: the colour you were
   playing is the coach's now, and it answers straight away if that side is to
   move. Mid-game is a fair moment to do it — the position is untouched, and
   taking over the side you have been playing against is the whole point. */
function flip(){
  userColor = userColor === "w" ? "b" : "w";
  saveSession();
  sel = null; legalTargets = []; draw();
  /* "you won" and "you lost" swap with the sides */
  if (game.game_over()){ finish(); return; }
  if (coachMode && !busy && reviewPly === null && game.turn() !== userColor) step();
}
$("flip").onclick = flip;

/* The right-hand panel collapses whole — candidates, move list and all. Its
   own Hide button goes with it, so the toolbar button is the way back, and
   the board claims the freed width. */
function setPanel(v){
  panelOpen = v;
  $("sidepanel").hidden = !panelOpen;
  $("cols").classList.toggle("solo", !panelOpen);
  wrapEl.classList.toggle("solo", !panelOpen);   // the app is board-wide now
  $("peek").textContent = panelOpen ? "Hide panel" : "Show panel";
  $("candtoggle").setAttribute("aria-expanded", String(panelOpen));
  saveSession();
  sizeBoard();
  if (panelOpen) renderCands();
}
$("peek").onclick = () => setPanel(!panelOpen);
$("candtoggle").onclick = () => setPanel(false);

/* the two toggles wear their state, so the buttons are painted from it rather
   than flipped alongside it — restoring a session sets the flags and calls this */
function syncToggleUI(){
  $("coach").classList.toggle("on", coachMode);
  $("coach").textContent = coachMode ? "Coach: On" : "Coach: Off";
  $("vary").classList.toggle("on", variety);
  $("vary").textContent = variety ? "Variety: On" : "Variety: Off";
  $("best").classList.toggle("on", showBest);
  $("best").textContent = showBest ? "Best: On" : "Best: Off";
}
function setCoach(v){
  coachMode = v;
  syncToggleUI(); saveSession();
  sel = null; legalTargets = []; draw();
  /* the button already says which it is; the line under the board goes back to
     describing the position, which is all it ever does now */
  if (!game.game_over()) reportViewedMove();
  if (coachMode && !busy && reviewPly === null && !game.game_over()
      && game.turn() !== userColor) step();
}
$("coach").onclick = () => setCoach(!coachMode);
function setVariety(v){
  variety = v;
  syncToggleUI(); saveSession();
  renderCands();                    // the in-play marks appear or clear with it
}
$("vary").onclick = () => setVariety(!variety);
function setBest(v){
  showBest = v;
  syncToggleUI(); saveSession();
  renderBest();
}
$("best").onclick = () => setBest(!showBest);

/* on-screen equivalents of the arrow keys, for anyone without a keyboard */
$("prev").onclick = () => gotoPly((reviewPly === null ? game.history().length : reviewPly) - 1);
$("next").onclick = () => { if (reviewPly !== null) gotoPly(reviewPly + 1); };
function syncNav(){
  const n = game.history().length;
  $("prev").disabled = n === 0 || reviewPly === 0;
  $("next").disabled = reviewPly === null;
}

/* keyboard: arrows review the game, C the coach, V variety, B the engine's
   best, F swaps sides. Ignored while a text control has focus, so typing
   never moves the board. */
document.addEventListener("keydown", e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if (t && (/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) || t.isContentEditable)) return;
  const n = game.history().length;
  const at = reviewPly === null ? n : reviewPly;
  switch (e.key){
    case "ArrowLeft":  e.preventDefault(); gotoPly(at - 1); break;
    case "ArrowRight": e.preventDefault(); gotoPly(at + 1); break;
    case "Home":       e.preventDefault(); gotoPly(0); break;
    case "End":        e.preventDefault(); gotoPly(n); break;
    case "c": case "C": e.preventDefault(); setCoach(!coachMode); break;
    case "v": case "V": e.preventDefault(); setVariety(!variety); break;
    case "b": case "B": e.preventDefault(); setBest(!showBest); break;
    case "f": case "F": e.preventDefault(); flip(); break;
  }
});
$("pgn").onclick = () => {
  const txt = game.pgn({max_width:80, newline_char:"\n"});
  navigator.clipboard.writeText(txt).then(
    () => { $("pgn").textContent = "PGN copied"; setTimeout(() => $("pgn").textContent = "Copy PGN", 1400); },
    () => prompt("Copy the PGN:", txt));
};
$("tok").onclick = () => {
  const v = prompt("Paste your Lichess personal access token.\n\nCreate one at lichess.org/account/oauth/token/create — no scopes needed.\nLeave empty to remove the stored token.", token);
  if (v === null) return;
  token = v.trim();
  try { token ? localStorage.setItem("lichessToken", token) : localStorage.removeItem("lichessToken"); } catch(e){}
  $("tok").textContent = token ? "Token saved" : "Lichess token";
  apiDown = false; cache.clear(); reachBy.clear(); $("offline").hidden = true;
  refreshPosition();
};
$("retry").onclick = () => {
  apiDown = false; cache.clear(); reachBy.clear();
  $("offline").hidden = true;
  $("retry").textContent = "Checking…";
  refreshPosition().then(() => {
    $("retry").textContent = apiDown ? "Retry database" : "Database live";
    setTimeout(() => $("retry").textContent = "Retry database", 2000);
  });
};
async function refreshPosition(){
  const line = game;
  busy = true; book = null; renderCands();
  const data = await lookUp(game.fen());
  if (game !== line){ busy = false; return; }     // the line changed under us
  book = data;
  absorbOpening(book); renderRibbon(); renderCands();
  busy = false;
  /* never move for the coach while the board is showing an earlier position */
  if (coachMode && reviewPly === null && game.turn() !== userColor && !game.game_over()) step();
}
/* Starting a game and picking one back up are the same act: point everything
   at a game object and let the panels describe whatever position it is at. */
function startFrom(g, kept){
  game = g;
  exitReview(); hideTip();
  evalByPly = (kept && kept.evals) || [];
  openByPly = (kept && kept.opens) || [];
  vhCache = {len:-1, list:[]};
  sel = null; legalTargets = []; book = null;
  /* the opening state is whatever the deepest surviving record says it is —
     the same reading branchAt does, and for the same reason: these four
     describe the line the game is in, and the records are what remember it */
  const rec = openingAt(g.history().length);
  lastName = rec ? rec.name : null;
  lastEco = rec ? rec.eco : null;
  bookPlies = rec ? rec.namedAt : 0;
  outOfBook = rec ? !!rec.out : false;
  saveSession();
  $("note").textContent = ""; draw(); renderMoves(); renderRibbon(); updateEval();
  /* a game picked back up after it ended still knows how it ended */
  if (game.game_over()) finish();
  refreshPosition();          // and the coach moves from here if it is its turn
}
function newGame(){ startFrom(new Chess()); }
/* A PGN chess.js will not read is dropped rather than argued with: a new game
   is a better answer than half of an old one. */
function restoreGame(saved){
  if (!saved || !saved.pgn) return false;
  const g = new Chess();
  if (!g.load_pgn(saved.pgn)) return false;
  const plies = g.history().length;
  startFrom(g, {evals: cleanEvals(saved.evals, plies), opens: cleanOpens(saved.opens, plies)});
  return true;
}

if (token) $("tok").textContent = "Token saved";
pools = storedPools() || DEFAULT_POOLS.slice(); renderChips();
/* The flags are set before the UI is painted from them, rather than run
   through setCoach/setVariety: those two are for a person changing their mind
   mid-game, and setCoach would hand the opening move to the coach here, on a
   board the stored game has not been laid out on yet. */
const saved = loadSession();
if (saved){
  if (saved.side === "w" || saved.side === "b") userColor = saved.side;
  coachMode = saved.coach !== false;
  variety = !!saved.vary;
  showBest = !!saved.best;
}
syncToggleUI();
setPanel(!saved || saved.panel !== false);
draw();
if (!restoreGame(saved)) newGame();
