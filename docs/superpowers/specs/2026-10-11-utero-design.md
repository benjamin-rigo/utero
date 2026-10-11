# utero: design spec

Dátum: 2026-10-11 · Státusz: review alatt · Wireframe: [assets/2026-10-11-layout-v7b.html](assets/2026-10-11-layout-v7b.html)

## 1. Cél

Személyes, egy képernyőbe férő digitális workstation, két feladatra:

1. gyors ötletgenerálás,
2. élő techno performansz (Kangding Ray-irány, de személyre szabva).

Egyetlen felhasználó, nem kereskedelmi termék.

**Hangzásbeli irány:**
- analóg, tökéletlen hullámformák,
- zaj, ami nemcsak külön réteg, hanem modulál is,
- cross-mod és feedback,
- finom torzítás, Erbe-Verb-szerű reverb, analóg/tape delay, comb, textúrák,
- mindez kontrasztban a digitális hangzással.

**Siker:** egy üres scene-ből percek alatt élő, mozgó groove lesz. Élőben a busok ki/be kapcsolása, a bus FX-ek és a macrók adják a dramaturgiát. Mindez recsegés nélkül.

## 2. Rögzített döntések

| Téma | Döntés |
|---|---|
| Platform | Először webapp (Chrome). Később natív standalone ugyanazzal a DSP maggal. |
| DSP | Rust → WASM, egyetlen AudioWorklet processzor. |
| UI | React + Vite + Tailwind/shadcn (dark), a nagy frissítésű részek canvasra rajzolva. |
| Vezérlés | **Minden a felületen** (egér + billentyűzet). MIDI kontroller csak opcionális, generikus MIDI learn-nel. |
| Sequencer-minták | Elektron (p-lock, trig condition) + Torso T-1 (generátor, random depth, mutate). |
| Busok | 8 fader: KICK · HATS · PERC · BASS · LEAD · PAD · ORN · FX RTN. |
| Scene | Projektenként 16. Mindent tartalmaz (szekvencia, hang, mod, FX, macró, akkord). Másolható. A mixer-faderek globálisak. |
| Scene-hossz | Alapból INF (nincs reset). A váltás időzítése (CHANGE) scene-enként: azonnal / 1 / 2 / 4 / 8 / 16 ütem. Opcionális RESET 4/8/16 ütemenként. |
| Moduláció | 16 globális modulátor scene-enként. Ráhúzással route-olod őket bármelyik paraméterre. |
| Macrók | 8 A/B fader (Octatrack-logika), LEARN gesztussal. Nincs külön crossfader. |
| Akkordok | Chord Palette két móddal (KEY / SHAPE), Barker-féle indexes választással. |
| Sample | Saját mappa (File System Access API) + resampling bármelyik busról vagy a masterről. |
| Felvétel | Master → WAV (REC gomb). |

## 3. Teljes termék: alprojektek

Minden alprojekt saját spec → terv → implementáció ciklust kap. Ez a dokumentum a teljes képet és **az 1. alprojektet** részletezi.

1. **Vertikális szelet**, ez a dokumentum: engine, transport, sequencer, moduláció, macrók, KICK/KICK2, SUB, MID, bus-lánc, send A/B, master, UI-váz, MIDI learn.
2. **Dob machine-ek:** HH, OH, NOISE, SNARE (komplex FM tone), SAMPLE, plusz a sample-mappa böngésző.
3. **Pad / akkord-rendszer:** Chord Palette, ambient pad engine, granular, resampling.
4. **Dallamos machine-ek:** LEAD1 (DPO-szerű komplex osc), LEAD2 (FM), ORN (díszítő FM, Digitone-irány), skála- és akkordkövetés.
5. **Scene-rendszer:** 16 scene, copy/paste, kvantált váltás, projekt mentés/betöltés, WAV felvétel.
6. **Vizuális polish:** végleges vizuális stílus (Elektron / tapefiasco-irány).
7. **Standalone port:** natív audio (cpal) + Tauri.

## 4. Layout

Egy képernyő, három egység, a wireframe v7b alapján.

- **Felső sáv:** projekt, hangnem, BPM, transport (play/stop/REC), 16 scene gomb, COPY/PASTE, CHANGE időzítés, ütemszámláló, MIDI- és CPU-jelző.
- **Bal felső: sequencer-mátrix.**
  - Minden sáv egy sor, busok szerint csoportosítva, mindig minden látszik (nincs kinyitás).
  - Sorvégi fogantyú = sávhossz. Húzással állítod, vagy ⌥ + kattintással egy lépésre. A hosszon túli rész csíkozott.
  - Minden sávnak saját playheadje van. Sorvégen: hossz, sebesség, oldal-pöttyök, generátor-címke.
  - A felül választott edit mód az egész rácsra érvényes: TRIG · PROB · COND · LOCK · µTIME · RETRIG · NOTE.
  - VIEW: 1–16 / 17–32 / 33–48 / 49–64, valamint FOLLOW.
- **Bal alsó: modulátor-sáv.**
  - Balra a kijelölt modulátor szerkesztője, jobbra 16 csempe 2×8-ban: élő hullámkép, név, rate, célok száma.
- **Jobb oszlop: machine panel** (mindig a kiválasztott sáv).
  - Machine-típus, preset, fülek (oldalak), élő vizualizáció, 8 paraméter (2×4).
  - Alatta a kattintott paraméter modulációi.
  - Legalul a 8 A/B macró-fader.
- **Alsó sáv: mixer.** 8 bus (FLT, DRV, send A, send B, fader, meter, MUTE) és a master (COMP, SAT, TILT, LIMIT, LUFS).

**Vizuális kódok:**
- narancs = kijelölés, aktív, érték,
- kék = moduláció,
- piros = élesített LEARN, mute,
- csíkozott = a sávhosszon túli rész.

### Interakciók (kontroller nélkül)

**Gombok, paraméterek**
- Függőleges húzás állítja az értéket, ⇧ + húzás finoman.
- Duplakattintás visszaállítja az alapértéket.
- Kattintás az értékre: szám beírása.
- Görgő: lépésenkénti állítás.

**Lépések**
- Kattintás: trig be/ki.
- Húzás több lépésen: festés.
- Hosszú nyomás vagy ⌘ + kattintás egy lépésen, majd paraméter-állítás: p-lock.
- PROB módban függőleges húzás a valószínűség. COND módban kattintásra menü nyílik.

**Moduláció**
- Csempe vagy ⊕ ráhúzása egy paraméterre: új route.
- A gyűrű kék ívének húzása: mennyiség (bipoláris, ⌥ = unipoláris).
- Modulátor fölé vitt egér: minden célpontja kiemelődik.

**Billentyűzet**
- Szóköz: play/stop.
- 1–8: bus mute.
- Q–I: a machine panel oldalai.
- F (nyomva tartva): FILL.
- R nyomva + paraméter húzása: random depth (mint a T-1 RANDOM gombja).
- A scene-ek billentyűzetes kiosztása nyitott (15. pont).

**MIDI learn**
- A jobb klikk → "Learn" bármelyik paraméterre, faderre, macróra és mute-ra működik.
- Encodereknél relatív mód, abszolút CC-nél pickup (nincs érték-ugrás).

## 5. Architektúra

```
┌──────────── main thread ────────────┐      ┌────── audio thread (AudioWorklet) ──────┐
│ React UI · canvas renderers          │      │ wasm: utero-core                         │
│ Project store (source of truth)      │─cmd─▶│  transport · sequencer · mod matrix      │
│ Web MIDI in/learn                    │ ring │  machines · buses · sends · master       │
│ persistence (IndexedDB, file export) │◀snap─│  state snapshot (playheads, meters,      │
│ sample loader (File System Access)   │ SAB  │  modulated values)                       │
└──────────────────────────────────────┘      └──────────────────────────────────────────┘
        postMessage (transfer): sample buffers, teljes projekt/scene betöltés
```

**Rust workspace**
- `crates/core`: platformfüggetlen DSP és engine. `no_std`-barát, a process útvonalán nincs foglalás.
- `crates/wasm`: wasm-bindgen binding, a ring buffer kezelése.
- `crates/native`: később.

**Web**
- `web/`: Vite + React app és az AudioWorklet loader.

**Kommunikáció**
- **Parancs-ring (UI → engine):** SharedArrayBuffer, fix méretű, lock-free SPSC. Üzenettípusok: param set, step edit, transport, scene queue, route add/remove, macro learn.
- **Snapshot (engine → UI):** dupla pufferelt SAB, a UI requestAnimationFrame-mel olvassa. Tartalma: playheadek, meterek, modulált paraméter-értékek, CPU-terhelés.
- **Nagy adatok** (sample, teljes scene): postMessage transferrel. Az engine előre foglalt slotokba másolja őket az audio threaden kívül, vagy dupla pufferrel cseréli.

**Platform-követelmény:** a SharedArrayBuffer cross-origin isolationt igényel (`COOP: same-origin`, `COEP: require-corp`). Ezt a Vite dev szervernek és a hostingnak is be kell állítania.

**Audio:** 48 kHz, `latencyHint: "interactive"`, a Web Audio blokkmérete 128 sample.

**Realtime szabályok:**
- A `process()`-ben nincs foglalás, lock vagy I/O.
- Minden voice és buffer előre foglalt.
- Minden folytonos paraméter simítva változik.

**Időzítés**
- A transport sample-pontos.
- A belső felbontás 96 PPQN a µtime-hoz.
- A scene-váltás pontosan a CHANGE határon történik, az audio threaden.

## 6. Adatmodell (sorosítható, verziózott)

```
Project { version, name, bpm, key { root, scale }, chordPalettes[], scenes[16], mixer (global), midiMap }
Scene   { name, changeQuant, resetBars|INF, tracks[13], modulators[16], routes[≤64], macros[8], sends{A,B}, master, busFx[8], chordTrack }
Track   { id, bus, machine { type, params{} }, seq { length 1–64, speed, swing?, steps[64], generator? } }
Step    { trig, vel, prob, cond, microtime, retrig{rate,count,curve}, gate, note|chordIdx, locks{paramId: value}, triglessLock }
Modulator { type LFO|RND|NOISE|STEP|ENVF|SC, shape, rate (sync|Hz), phase, polarity, mode FREE|RETRIG|ONESHOT, trigSrc?, smooth, depth }
Route   { modulatorId, target paramRef, amount (bipoláris) }
Macro   { name, targets[{ paramRef, a, b }], pos 0–1 }
paramRef = { scope: track|bus|send|master, id, param }
```

A forrás a UI-ban lévő store. Az engine tükörképet tart, és csak a változások mennek át neki. Minden paraméternek egy helyen van definiálva a neve, tartománya, alapértéke, egysége, görbéje és hogy lehet-e audio-rate célpont. Ebből generálódik a UI és a validáció is.

## 7. Sequencer

**Sáv**
- Hossz: 1–64.
- Sebesség: 1/32, 1/16, 1/8, 1/4, 1 bar, triolákkal.
- Swing: globális, sávonként felülírható.
- Saját playhead.

**Lépés**
- trig, velocity
- probability 0–100%
- feltétel: A:B, FILL, !FILL, PRE, !PRE, NEI, 1ST
- µtime: ±1/2 lépés
- retrig: rate, darabszám, velocity-görbe
- gate
- hang vagy akkord-index
- p-lock-ok bármelyik sáv-, bus- vagy send-paraméterre
- trigless lock

**Generátor (sávonként opcionális)**
- **Euclid:** pulses, rotate. A kimenete OR-ral fésülődik a kézi lépésekkel.
- **Dallam:** skálán vagy akkordhangokon belül, range-dzsel. Az első szeletben csak a basszusnál van értelme.

**Véletlen és variáció**
- **Random depth paraméterenként** (R nyomva + húzás): triggerenként ± véletlen eltérés.
- **MUTATE %:** minden körben ekkora eséllyel módosul egy lépés vagy érték.
- **REGEN:** újragenerál.
- A random seedelt, így reprodukálható.

**FILL:** nyomva tartott gomb vagy billentyű.

**Scene-hossz és váltás:** lásd a 2. pontot (INF alapértelmezés, CHANGE időzítés, opcionális RESET).

## 8. Moduláció és macrók

**Modulátorok:** 16 hely scene-enként, mindegyik bármilyen típus lehet.

- **LFO**
  - Elöl kiemelve: SIN, GLIDE (simított random), S&H (minden triggerre új érték, a TRIG SRC-ből).
  - Mögöttük: TRI, SAW, RAMP, SQR, EXP, DRIFT, DRAW. A ★ jelöli, mi kerüljön előre.
  - Az alapértelmezett rate **4 bar**, a lista lassú értékekkel indul (1 bar … 32 bar). Hz-módban 0,01 Hz-ig megy le.
- **RANDOM:** S&H, smooth, drift.
- **NOISE~:** audio rate, white / pink / crackle.
- **STEP:** 8/16 lépés, glide, mutate.
- **ENV.F:** egy bus hangereje a forrás.
- **SC.KICK:** rajzolt ducking-görbe a kick trigről, GHOST móddal.

**Route-ok**
- Scene-enként max. 64.
- Frissítés: 32 sample-önként (control rate).
- **Audio-rate** csak a jelölt célokon: pitch, cutoff, amp, FM/fold index. Itt NOISE~ vagy gyors LFO valódi cross-mod hangot ad.

**Macró:** 8 fader scene-enként, mindegyikhez A és B gomb.
- Az A élesítése (piros) után minden megérintett paraméter A-értéke rögzül. A B ugyanígy.
- Élesítéskor a fader az adott végre ugrik.
- A fader `a + (b − a) · pos` szerint interpolál.
- A célok listája halvány sorban látszik. A gyűrűkön a szürke pöcök az A, a kék a B érték a kijelölt macróhoz.

**Sorrend paraméterenként:** alapérték → p-lock → macró-interpoláció → modulációk összege → random depth → clamp.

## 9. Hang: az 1. alprojekt machine-jei

**Közös elvek**
- Sávkorlátozott oszcillátorok (polyBLEP vagy hasonló).
- DRIFT minden voice-on.
- 2–4× túlmintavételezett szaturációk.
- Minden machine-ben van NOISE, ami hozzáad **és** mikro-modulál (pitch/amp).
- Oldalanként 8 paraméter, kurátorált nevekkel.

**KICK** (a KICK2 ugyanez a machine)
- **SRC:** TUNE · SWEEP · S.TIME · DECAY · CLICK · DRIVE · NOISE · TONE
- **BODY:** WAVE (sin → tri → fold) · FOLD · DRIFT · CLICK TYPE (impulse / noise) · CLICK DEC · CLICK TONE · VEL→SWEEP · LEVEL
- **AMP:** ATTACK · HOLD · DECAY · CURVE · VEL · LEVEL · PAN · BUS
- **SC:** görbe (preset / rajzolt) · DEPTH · LENGTH · CURVE · busonkénti mélység (BASS / PAD / LEAD / ORN / FX) · GHOST

**SUB**
- OCT (0 / −1 / −2) · PHASE (retrig fázis) · DRIVE · GLIDE · DECAY · LEVEL · DRIFT · FOLLOW
- ROUTE: bus vagy DIRECT a masterre.

**MID**
- **SRC:** WAVE (saw ↔ pulse) · DETUNE (Reese) · FOLD · NOISE (ring/AM textúra) · DRIFT · OCT · GLIDE · FOLLOW
- **FLTR:** CUTOFF · RES · ENV AMT · DECAY · DRIVE · KEYTRK · TYPE (LP / BP) · LEVEL
- **LINK:** követheti a SUB szekvenciáját.

## 10. Busok, send FX, master

**Bus-lánc (mind a 8):** DJ FILTER (bipoláris, balra LP, jobbra HP, fix rezonancia) → DRIVE (tape, auto-gain) → SEND A / B → THROW (momentary 100%) → fader → MUTE (azonnali vagy kvantált).

**Send A: Reverb** (Erbe-Verb-jelleg, 100% wet)
- SIZE · DECAY (INF / freeze-ig) · ABSORB · TILT · MOD SPEED · MOD DEPTH · PREDELAY · LOW CUT

**Send B: Delay** (tape / BBD)
- TIME (sync / free) · FEEDBACK (>100%, szaturációval korlátozva) · TONE (LP / HP a hurokban) · WOW · FLUTTER · DRIVE · WIDTH · HISS

**FX RTN fader:** a két send közös visszatérése, saját gyors kontrollokkal (VERB, DLY, FB, SIZE).

**Master**
- **COMP:** AMOUNT (threshold és ratio együtt) · ATK · REL · MIX
- **SAT:** AMOUNT · CURVE
- **TILT:** ± · LOW CUT
- **LIMIT:** CEILING · CLIP / LIMIT
- **LUFS:** rövid távú meter

## 11. Teljesítmény

**Költségvetés (1. alprojekt):**
- teljes engine < 25% egy mag terhelésből (M-sorozatú Mac, Chrome, 48 kHz),
- nulla dropout 10 perc lejátszás alatt,
- UI 60 fps.

**Mérés**
- CPU-jelző a felső sávon (a `process()` ideje a blokkidőhöz képest).
- Offline benchmark natív Rust tesztben.

## 12. Tesztelés

**Rust unit tesztek (natív)**
- sequencer: feltételek, probability seedelt RNG-vel, polimetria, µtime, CHANGE / RESET határok;
- mod-mátrix: sorrend, clamp, macró-interpoláció;
- paraméter-simítás.

**Offline render tesztek:** minden machine és FX WAV-ba renderel. Ellenőrizzük:
- nincs NaN vagy Inf,
- nincs DC-offset,
- a csúcs a határon belül van,
- a CPU-idő a kereten belül van.

**Web**
- Store- és parancs-sorosítás tesztek.
- Egy smoke teszt: a worklet betölt, és szól.

**Zenei elfogadás:** te hallgatod meg a szeletet.

## 13. Az 1. alprojekt scope-ja

**Benne van**
- engine, transport, BPM
- teljes sequencer (7. pont)
- KICK, KICK2, SUB, MID
- 16 modulátor, route-ok, 8 A/B macró
- 8 bus-lánc, send A/B, master
- teljes layout (a hiányzó machine-ek sorai üresek / "nincs machine")
- egy scene (az adatmodell 16-ot tud)
- automatikus mentés IndexedDB-be
- MIDI learn

**Nincs benne:** 2–7. alprojekt (más machine-ek, pad / akkord, scene-váltás és másolás, sample-mappa, resampling, WAV felvétel, végleges vizuális stílus, standalone).

**Kész, ha:**
- egy kick + sub + mid groove eltérő sávhosszakkal recsegés nélkül szól,
- a moduláció ráhúzással működik,
- egy macró A/B-vel átúsztat egy "breakdownt",
- a bus mute és a filter élőben használható,
- a teljesítmény a 11. pont szerinti.

## 14. Későbbi alprojektek: rögzített irányok

- **Chord Palette**
  - **KEY mód:** 8 akkord a projekt hangnemből, mood-presetekkel (Dark minor, Dorian, Pentatonic sus, Barker-ish, Dub). Auto voice-leading. Javaslat a legsimább következő akkordra. Az index p-lockolható és modulálható.
  - **SHAPE mód:** egy akkordforma párhuzamos tolása, a gyökhang kvantált vagy szabad.
  - A BASS, LEAD és ORN sávok követhetik az akkordot.
- **Pad engine:** detunolt "rossz" oszcillátor-akkord + sample / field recording réteg + granular freeze / smear (S-4 Mosaic-jelleg) + hosszú modulált reverb + tape wow / flutter + kick-pumpa + zajágy.
- **Dobok:** Machinedrum-szerű, kurátorált kontrollok. A snare komplex FM tone generator.
- **LEAD1:** DPO-szerű kettős oszcillátor (FM bus, fold, shape / angle, cross-mod).
- **LEAD2 és ORN:** FM (Digitone II irány).
- **Sample:** saját mappa böngészése, resampling bármelyik busról vagy a masterről bufferbe.

## 15. Nyitott pontok (nem blokkolják az 1. alprojektet)

- Végleges vizuális stílus: kellenek tapefiasco- és Elektron-referencia screenshotok.
- A billentyűparancsok végleges kiosztása.
- A pad engine részletes paraméterei (a 3. alprojekt spec-jében).
