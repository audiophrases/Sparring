/* ============================================================
   Sparring Coach — an opponent that plays the crowd.
   Moves come from the Lichess opening explorer while the game is
   still in book; a small local search takes over afterwards.
   ============================================================ */

/* ============================ config ============================ */
/* Lichess exposes fixed rating buckets: 1000 1200 1400 1600 1800 2000 2200 2500.
   Each level maps to a run of them, and the runs overlap on purpose so the pool
   of games stays wide and the jump in strength between levels stays gentle. */
const LEVELS = {
  beginner: {label:"Beginner · 600–1200", pool:"600–1200",
             ratings:"1000,1200", speeds:"blitz,rapid,classical",
             temp:1.9, minGames:1, depth:1, wild:0.22,
             blurb:"Copies the beginner crowd (Lichess 1000–1200 pools): sound first moves, then the popular-but-loose tries. Sometimes plays a move almost nobody plays."},
  club:     {label:"Club · 900–1600", pool:"900–1600",
             ratings:"1000,1200,1400,1600", speeds:"blitz,rapid,classical",
             temp:1.25, minGames:2, depth:2, wild:0.10,
             blurb:"Samples the 1000–1600 pools in proportion to how often each move is really played. Mainstream, but not always the top choice."},
  strong:   {label:"Strong · 1300–2200", pool:"1300–2200",
             ratings:"1400,1600,1800,2000,2200", speeds:"blitz,rapid,classical",
             temp:0.8, minGames:4, depth:3, wild:0.02,
             blurb:"Leans hard toward the main line of the 1400–2200 pools, with occasional respectable sidelines."},
  master:   {label:"Master · 2000+", pool:"2000+",
             ratings:"2000,2200,2500", speeds:"blitz,rapid,classical",
             temp:0.32, minGames:4, depth:3, wild:0,
             blurb:"Near enough the main line every time: whatever the strongest pools Lichess exposes (2000–2500) play most in this exact position."}
};
const FILES = "abcdefgh";

/* Every bucket Lichess exposes, low to high. A level seeds a selection out of
   these; from there they are yours to widen — a rare position is thin in one
   pool and perfectly well covered three pools down. */
const BUCKETS = [1000,1200,1400,1600,1800,2000,2200,2500];
const THIN = 300;          // total games below which the panel suggests widening

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
let orientation = "w";
let userColor = "w";
let level = "club";
let book = null;          // explorer payload for the current position
let lastName = null, lastEco = null, bookPlies = 0, outOfBook = false;
let sel = null, legalTargets = [], lastMove = null, busy = false, peek = true;
let coachMode = true;  // false = free play, you move both sides
let pending = null;       // promotion pending {from,to,color}
let pools = [];           // selected Lichess rating buckets
/* Review: the board shows an earlier position while `game` stays at the live
   one, so stepping back and forth costs nothing and never rewrites the game.
   reviewPly is the number of plies shown; null means we are on the live move. */
let reviewPly = null, reviewGame = null, reviewMove = null, savedNote = null;
let apiDown = false;
let token = "";
try { token = localStorage.getItem("lichessToken") || ""; } catch(e){}

const $ = id => document.getElementById(id);

/* ============================ board ============================ */
const boardEl = $("board");
const boardCol = document.querySelector(".boardcol");
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
const MAX_BOARD = 640, MIN_BOARD = 192;
let boardSize = 0;
function sizeBoard(){
  const avail = boardCol.clientWidth;
  const fitsHeight = Math.max(280, window.innerHeight - 180);
  const raw = Math.min(avail, MAX_BOARD, fitsHeight);
  const size = Math.max(MIN_BOARD, Math.floor(raw / 8) * 8);
  if (size === boardSize) return;
  boardSize = size;
  document.documentElement.style.setProperty("--board", size + "px");
}
sizeBoard();
window.addEventListener("resize", sizeBoard);
if (window.ResizeObserver) new ResizeObserver(sizeBoard).observe(boardCol);

function sqName(i){
  let r = Math.floor(i/8), f = i%8;
  if (orientation === "b"){ r = 7-r; f = 7-f; }
  return FILES[f] + (8-r);
}
function draw(){
  const view = reviewGame || game;
  const hl = reviewGame ? reviewMove : lastMove;
  const b = view.board();
  const kingSq = view.in_check() ? findKing(view.turn(), view) : null;
  for (let i = 0; i < 64; i++){
    const name = sqName(i);
    const f = FILES.indexOf(name[0]), r = 8 - parseInt(name[1]);
    const p = b[r][f];
    const c = cells[i];
    c.className = "sq " + ((r+f) % 2 === 0 ? "l" : "d");
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
    if (exitReview()){ draw(); renderMoves(); }
    return;
  }
  if (reviewPly === null) savedNote = $("note").innerHTML;   // to restore on the way out
  const g = new Chess();
  for (let i = 0; i < n; i++) g.move(h[i].san);
  reviewPly = n; reviewGame = g; reviewMove = n ? h[n-1] : null;
  sel = null; legalTargets = [];
  draw(); renderMoves();
  const where = n
    ? "after " + Math.ceil(n/2) + (n % 2 ? "." : "…") + h[n-1].san
    : "at the starting position";
  $("note").innerHTML = '<b>Reviewing</b> — ' + where +
    '. <span class="hot">→</span> to step forward, End to rejoin the game.';
}
function exitReview(){
  if (reviewPly === null) return false;
  reviewPly = null; reviewGame = null; reviewMove = null;
  if (savedNote !== null){ $("note").innerHTML = savedNote; savedNote = null; }
  return true;
}

/* ============================ interaction ============================ */
function onSquare(i){
  if (busy || game.game_over()) return;
  if (reviewPly !== null){
    $("note").innerHTML = '<b>Reviewing an earlier position.</b> Press End (or → repeatedly) '
      + 'to rejoin the game before moving.';
    return;
  }
  if (coachMode && game.turn() !== userColor) return;
  const name = sqName(i);
  if (sel && legalTargets.includes(name)){
    const opts = game.moves({square: sel, verbose: true}).filter(m => m.to === name);
    if (opts.some(m => m.flags.includes("p"))) { pending = {from: sel, to: name, color: game.turn()}; showPromo(); return; }
    commit({from: sel, to: name});
    return;
  }
  const piece = game.get(name);
  if (piece && piece.color === game.turn()){
    sel = name;
    legalTargets = game.moves({square: name, verbose: true}).map(m => m.to);
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
  exitReview();
  const before = book;
  const m = game.move({from: mv.from, to: mv.to, promotion: mv.promotion || "q"});
  if (!m) { sel = null; legalTargets = []; draw(); return; }
  sel = null; legalTargets = []; lastMove = m;
  reportUserMove(m, before);
  draw(); renderMoves(); updateEval();
  step();
}

/* report how popular the human's own move was */
function reportUserMove(m, prev){
  if (!prev || !prev.moves || !prev.moves.length){
    $("note").innerHTML = outOfBook
      ? '<b>' + m.san + '</b> — past the database. Both sides are on their own now.'
      : '<b>' + m.san + '</b>';
    return;
  }
  const tot = prev.moves.reduce((s,x) => s + gcount(x), 0);
  const hit = prev.moves.find(x => x.san === m.san);
  if (!hit){
    $("note").innerHTML = '<b>' + m.san + '</b> — <span class="hot">not in the database</span> at this level. You just left book.';
    return;
  }
  const pct = 100 * gcount(hit) / tot;
  const rank = prev.moves.slice().sort((a,b) => gcount(b)-gcount(a)).findIndex(x => x.san === m.san) + 1;
  const word = pct > 40 ? "the main choice" : pct > 15 ? "a common choice" : pct > 3 ? "a sideline" : "rare";
  $("note").innerHTML = '<b>' + m.san + '</b> — ' + word + ': <span class="hot">' + pct.toFixed(1) +
    '%</span> of ' + poolLabel() + ' players, ' + fmt(gcount(hit)) +
    ' games (#' + rank + ' most played).';
}

/* ============================ turn loop ============================ */
async function step(){
  busy = true;
  book = null; renderCands(); renderRibbon();
  if (game.game_over()){ finish(); busy = false; return; }
  const data = await getBook(game.fen());
  book = data;
  absorbOpening(data);
  renderRibbon(); renderCands();
  if (!coachMode || game.turn() === userColor){ busy = false; return; }
  await sleep(260);
  const mv = chooseMove(data);
  const m = game.move(mv);
  lastMove = m;
  exitReview();          // the reply is the point — snap back to it
  draw(); renderMoves(); updateEval();
  if (game.game_over()){ book = null; renderCands(); finish(); busy = false; return; }
  const d2 = await getBook(game.fen());
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
  $("note").innerHTML = "<b>" + msg + "</b> Start a new game whenever you like.";
}

/* pick the opponent's move: book first, engine after */
function chooseMove(data){
  const cfg = LEVELS[level];
  const pool = data && data.moves ? data.moves.filter(m => gcount(m) >= cfg.minGames) : [];
  if (pool.length){
    outOfBook = false;
    if (Math.random() < cfg.wild){
      const tail = pool.slice(Math.floor(pool.length/2));
      const p = tail.length ? tail : pool;
      return p[Math.floor(Math.random()*p.length)].san;
    }
    const max = Math.max(...pool.map(gcount));
    const w = pool.map(m => Math.pow(gcount(m)/max, 1/cfg.temp));
    const sum = w.reduce((a,b) => a+b, 0);
    let x = Math.random() * sum;
    for (let i = 0; i < pool.length; i++){ x -= w[i]; if (x <= 0) return pool[i].san; }
    return pool[0].san;
  }
  outOfBook = true;
  return engineMove(cfg);
}
const gcount = m => (m.white||0) + (m.draws||0) + (m.black||0);

/* ============================ opening explorer ============================ */
const cache = new Map();
let lastCall = 0;
async function getBook(fen){
  const cfg = LEVELS[level];
  const key = fen + "|" + poolParam();
  if (cache.has(key)) return cache.get(key);
  if (apiDown) return null;
  const gap = Date.now() - lastCall;
  if (gap < 900) await sleep(900 - gap);
  const url = "https://explorer.lichess.ovh/lichess?variant=standard&moves=10&topGames=0&recentGames=0"
    + "&speeds=" + cfg.speeds + "&ratings=" + poolParam() + "&fen=" + encodeURIComponent(fen);
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
}

/* ============================ rendering ============================ */
function renderRibbon(){
  const rb = $("ribbon");
  if (!lastName){
    $("eco").textContent = "Opening"; $("oname").textContent = "Starting position";
    $("osub").textContent = "Make a move to begin."; rb.classList.remove("off");
    return;
  }
  $("eco").textContent = (lastEco ? lastEco + " · " : "") + (outOfBook ? "last named line" : "in book");
  $("oname").textContent = lastName;
  const ply = game.history().length;
  $("osub").textContent = outOfBook
    ? "Out of book after " + Math.ceil(bookPlies/2) + " moves — from here your opponent calculates instead of recalling."
    : "Named at move " + Math.ceil(bookPlies/2) + " · " + Math.ceil(ply/2) + " played";
  rb.classList.toggle("off", outOfBook);
  $("depth").textContent = outOfBook ? "out of book" : "";
}
function renderCands(){
  const el = $("cands"), lg = $("legend");
  const has = !!(book && book.moves && book.moves.length);
  const moves = has ? book.moves.slice().sort((a,b) => gcount(b) - gcount(a)) : [];
  const tot = moves.reduce((s,m) => s + gcount(m), 0);
  /* the game count stays on the header even when the rows are hidden — it is
     what tells you the pool has run thin, and it gives nothing away */
  $("poptot").textContent = has ? fmt(tot) + " games" : "";
  if (!peek){ lg.hidden = true; return; }
  if (busy && !book){ el.textContent = "Reading the database…"; lg.hidden = true; return; }
  if (!has){
    el.innerHTML = '<span class="ob">' + (apiDown ? "Database unavailable."
      : "No human games reach this position in the selected pools. You are both improvising.") + '</span>';
    if (!apiDown) addWidenHint(el, 0);
    lg.hidden = true; return;
  }
  const max = gcount(moves[0]);
  el.innerHTML = "";
  moves.slice(0, 7).forEach(m => {
    const n = gcount(m), pct = 100*n/tot;
    const row = document.createElement("div");
    row.className = "mv";
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
  if (tot < THIN) addWidenHint(el, tot);
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
  if (!h.length){ $("moves").innerHTML = '<span class="ob">No moves yet.</span>'; return; }
  /* the ply under review is marked, so the arrow keys have somewhere to point */
  const ply = i => '<b' + (reviewPly === i + 1 ? ' class="cur"' : '') + '>' + h[i] + '</b>';
  /* the trailing spaces are load-bearing: they are the only places the list is
     allowed to wrap, since each move itself is nowrap. The number stays glued
     to White's move because there is no space between them. */
  let out = "";
  for (let i = 0; i < h.length; i += 2){
    out += '<span class="no">' + (i/2+1) + '.</span>' + ply(i) + " ";
    if (h[i+1]) out += ply(i+1) + " ";
  }
  /* scrolled by hand rather than with scrollIntoView, which also nudges the
     inline axis and the page around it */
  const m = $("moves"); m.innerHTML = out;
  const cur = m.querySelector(".cur");
  m.scrollTop = cur ? Math.max(0, cur.offsetTop - m.clientHeight / 2) : m.scrollHeight;
}
const fmt = n => n >= 1e6 ? (n/1e6).toFixed(1) + "M" : n >= 1000 ? (n/1000).toFixed(n >= 1e4 ? 0 : 1) + "k" : String(n);
const sleep = ms => new Promise(r => setTimeout(r, ms));

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
/* centipawns → share of the bar, squashed so ±3 pawns already looks decisive */
function cpToPct(cp){ return 100 / (1 + Math.exp(-cp/350)); }
function cpLabel(cp){
  const p = cp/100;
  return (p >= 0 ? "+" : "-") + Math.abs(p).toFixed(Math.abs(p) >= 10 ? 0 : 1);
}

async function updateEval(){
  const mine = ++evalToken;
  const g = new Chess(game.fen());

  if (g.game_over()){
    if (g.in_checkmate()) paintEval(g.turn() === "w" ? 0 : 100, g.turn() === "w" ? "0–1" : "1–0", null, 1);
    else paintEval(50, "½–½", null, 1);
    $("evalbar").title = "The game is over.";
    return;
  }

  paintEval(evalPct, "…", evalThinSide, evalThick, true);
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
  const thick = Math.min(1, Math.max(RES_MIN, resilience / RES_FULL));

  const white = g.turn() === "w" ? best : -best;    // negamax is side-to-move relative
  const leader = white > 0 ? "w" : white < 0 ? "b" : null;
  /* Resilience is measured over the moves of the side to move, so it only
     describes an advantage when that side is the one holding it. */
  const thinSide = leader === g.turn() ? leader : null;

  const label = Math.abs(white) >= 9000 ? (white > 0 ? "#" : "-#") : cpLabel(white);
  const pct = Math.abs(white) >= 9000 ? (white > 0 ? 100 : 0) : cpToPct(white);
  paintEval(pct, label, thinSide, thick);

  const mover = g.turn() === "w" ? "White" : "Black";
  $("evalbar").title = "Engine evaluation from White's point of view: " + label
    + " — " + mover + " has " + (capped ? RES_FULL + " or more moves" : resilience.toFixed(1)
      + " move" + (resilience >= 1.95 ? "s" : "")) + " that hold the position"
    + (thinSide ? ". The thin bar means that advantage rests on very few moves." : ".");
}

/* ============================ pools ============================
   The level seeds a selection; widening it trades strength for coverage,
   which is the trade you want once a line stops appearing in the games of
   the band you picked. The cache key carries the pools, so flipping back
   to a set you have already read costs no request. */
function poolParam(){ return pools.join(","); }
function poolLabel(){
  const preset = LEVELS[level].ratings.split(",");
  if (preset.length === pools.length && preset.every((v,i) => +v === pools[i])) return LEVELS[level].pool;
  if (pools.length === 1) return String(pools[0]);
  const idx = pools.map(v => BUCKETS.indexOf(v));
  const run = idx.every((v,i) => i === 0 || v === idx[i-1] + 1);
  return run ? pools[0] + "–" + pools[pools.length-1] : pools.join(" / ");
}
function renderChips(){
  const box = $("chips");
  box.innerHTML = "";
  BUCKETS.forEach(v => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip" + (pools.includes(v) ? " on" : "");
    b.textContent = v;
    b.title = "Lichess " + v + " pool";
    b.setAttribute("aria-pressed", String(pools.includes(v)));
    b.onclick = () => setPools(pools.includes(v) ? pools.filter(x => x !== v) : pools.concat(v));
    box.appendChild(b);
  });
  $("widen").disabled = pools.length >= BUCKETS.length;
  $("poolreset").disabled = poolLabel() === LEVELS[level].pool;
}
function setPools(next){
  const sorted = BUCKETS.filter(v => next.includes(v));
  if (!sorted.length) return;                     // never leave the book with nothing to read
  pools = sorted; renderChips(); refreshPosition();
}
function widenPool(){
  const idx = pools.map(v => BUCKETS.indexOf(v));
  const next = pools.slice();
  const lo = Math.min(...idx), hi = Math.max(...idx);
  if (lo > 0) next.push(BUCKETS[lo-1]);
  if (hi < BUCKETS.length - 1) next.push(BUCKETS[hi+1]);
  setPools(next);
}
function levelPools(){ return LEVELS[level].ratings.split(",").map(Number); }

/* ============================ controls ============================ */
const lv = $("level");
Object.entries(LEVELS).forEach(([k,v]) => {
  const o = document.createElement("option"); o.value = k; o.textContent = v.label; lv.appendChild(o);
});
lv.value = level;
lv.onchange = () => {
  level = lv.value;
  $("expl").textContent = LEVELS[level].blurb;
  pools = levelPools(); renderChips();
  refreshPosition();
};
$("widen").onclick = widenPool;
$("poolreset").onclick = () => setPools(levelPools());
$("side").onchange = () => { userColor = $("side").value; orientation = userColor; newGame(); };
$("newg").onclick = newGame;
$("flip").onclick = () => { orientation = orientation === "w" ? "b" : "w"; draw(); };

/* the candidates panel: one state, two controls — the toolbar button and the
   collapse toggle on the panel itself */
function setPeek(v){
  peek = v;
  $("peek").classList.toggle("on", peek);
  $("peek").textContent = peek ? "Show candidates" : "Candidates hidden";
  $("candtoggle").textContent = peek ? "Hide" : "Show";
  $("candtoggle").setAttribute("aria-expanded", String(peek));
  $("cands").hidden = !peek;
  renderCands();
}
$("peek").onclick = () => setPeek(!peek);
$("candtoggle").onclick = () => setPeek(!peek);

function setCoach(v){
  coachMode = v;
  $("coach").classList.toggle("on", coachMode);
  $("coach").textContent = coachMode ? "Coach: On" : "Coach: Off";
  sel = null; legalTargets = []; draw();
  if (!coachMode){
    $("note").innerHTML = '<b>Free play.</b> You move both sides; the database keeps following along.';
    return;
  }
  $("note").textContent = "";
  if (!busy && reviewPly === null && !game.game_over() && game.turn() !== userColor) step();
}
$("coach").onclick = () => setCoach(!coachMode);

$("undo").onclick = () => {
  if (busy) return;
  exitReview();
  game.undo(); if (coachMode && game.turn() !== userColor) game.undo();
  const h = game.history({verbose:true});
  lastMove = h.length ? h[h.length-1] : null;
  sel = null; legalTargets = []; $("note").textContent = "";
  draw(); renderMoves(); updateEval(); refreshPosition();
};

/* keyboard: arrows review the game, C toggles the coach. Ignored while a
   control has focus, so arrowing through the level select still works. */
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
  apiDown = false; cache.clear(); $("offline").hidden = true;
  refreshPosition();
};
$("retry").onclick = () => {
  apiDown = false; cache.clear();
  $("offline").hidden = true;
  $("retry").textContent = "Checking…";
  refreshPosition().then(() => {
    $("retry").textContent = apiDown ? "Retry database" : "Database live";
    setTimeout(() => $("retry").textContent = "Retry database", 2000);
  });
};
async function refreshPosition(){
  busy = true; book = null; renderCands();
  book = await getBook(game.fen());
  absorbOpening(book); renderRibbon(); renderCands();
  busy = false;
  if (coachMode && game.turn() !== userColor && !game.game_over()) step();
}
function newGame(){
  game = new Chess();
  exitReview(); savedNote = null;
  lastMove = null; sel = null; legalTargets = []; book = null;
  lastName = null; lastEco = null; bookPlies = 0; outOfBook = false;
  $("note").textContent = ""; draw(); renderMoves(); renderRibbon(); updateEval();
  refreshPosition();
}

$("expl").textContent = LEVELS[level].blurb;
if (token) $("tok").textContent = "Token saved";
pools = levelPools(); renderChips();
setPeek(true);
draw();
newGame();
