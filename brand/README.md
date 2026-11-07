# BYOA brand: Dock identity v1.0

**BYOA** (Bring Your Own Agent). The symbol is a dot (your agent) resting in an open cradle (any app that makes room for it). The cradle is open, so the agent is held but never locked in. It also reads as a “U”, for you.

## Files

| File | Use |
|---|---|
| `svg/byoa-symbol.svg` · `-dark` · `-black` · `-white` | Symbol, standard master (24 grid). 20 px and up |
| `svg/byoa-symbol-16.svg` · `-16-dark` | Small master (16 grid). Toolbar, menus, 12–19 px |
| `svg/byoa-symbol-16-idle.svg` · `-16-idle-dark` | Toolbar when no agent is connected |
| `svg/byoa-symbol-16-on-ink.svg` | Inside the ink “Connect BYOA” button |
| `svg/byoa-wordmark.svg` · `-dark` · `-black` · `-white` | Wordmark: Nunito Black, outlined. Use the file; never retype “BYOA” as live text for the logo |
| `svg/byoa-lockup.svg` · `-dark` · `-black` · `-white` | Horizontal lockup (default) |
| `svg/byoa-lockup-stacked.svg` | Stacked lockup: store pages, splash |
| `svg/byoa-app-icon-128.svg` | Store icon: 96 px artwork, 16 px transparent padding |
| `tokens.css` · `tokens.json` | Color, type and button tokens |

The symbol uses live strokes with round caps, so it stays editable in Figma, Illustrator or Inkscape. If a tool needs filled shapes, use Outline Stroke on a copy and keep the stroke files as the source. The wordmark letters are filled outlines of Nunito Black, so the files render the same without the font installed.

## Symbol

| | Standard (24 grid) | Small (16 grid) |
|---|---|---|
| Cradle | `M5 5.5V11.5A7 7 0 0 0 19 11.5V5.5`, stroke 3.5, round caps | `M3.25 3.5V7.75A4.75 4.75 0 0 0 12.75 7.75V3.5`, stroke 2.5 |
| Dot | cx 12, cy 8, r 3.5 | cx 8, cy 5.5, r 2.25 |
| Dot-to-wall gap | 1.75 | 1.25 px (never under 1 px) |

- **Clear space:** one dot diameter on every side.
- **Minimums:** symbol 12 px, lockup 72 px wide, wordmark 10 px tall. Below 12 px, use the name alone.
- **Status:** idle = Pebble dot; connected = Tangerine dot. No animation needed. Never use color alone to show status: the tooltip and button label always say so.

## Wordmark and lockups

- **Wordmark:** “BYOA” in Nunito Black (900), tracking +0.01em, with the font’s own kerning, converted to outlines. Cap height is 20 units in `byoa-wordmark.svg`.
- **Horizontal lockup:** symbol in a 48 px box, wordmark set at 44 px (its cap height matches the cradle’s height), 10 px from the symbol box to the B. Caps are centred on the symbol.
- **Stacked lockup:** symbol in a 72 px box, wordmark at 44 px centred 12 px below the cradle.
- Rebuild these files from the font, never by hand: the outlines come from the variable Nunito pinned to weight 900.

## Icon sizes

| Where | Size | File |
|---|---|---|
| Browser toolbar | 16, 32 (2×) | `byoa-symbol-16*.svg`. Swap light/dark with `chrome.action.setIcon`; Firefox: `theme_icons` |
| Menus, popup header | 16–24 | `byoa-symbol-16.svg` + wordmark at 12 px tall |
| Extension page | 48 | `byoa-symbol.svg` |
| Store listing | 128 | `byoa-app-icon-128.svg` |
| Connect button | 16 in a 32–40 px button | `byoa-symbol-16-on-ink.svg` |

## Color

| Light | Hex | RGB | Use |
|---|---|---|---|
| Ink | `#15171C` | 21 23 28 | Cradle, wordmark, text, primary button (17:1 on Paper) |
| Paper | `#FAF9F6` | 250 249 246 | Backgrounds |
| Tangerine | `#F05A28` | 240 90 40 | The dot only (connected). 3.2:1, never for text |
| Stone | `#5E6168` | 94 97 104 | Secondary text (5.9:1 on Paper) |
| Pebble | `#A3A6AD` | 163 166 173 | Idle dot, disabled |
| Mist | `#E7E5E0` | 231 229 224 | Borders |

| Dark | Hex | RGB | Use |
|---|---|---|---|
| Night | `#15171C` | 21 23 28 | Background |
| Surface | `#1F2228` | 31 34 40 | Popup, cards |
| Chalk | `#F3F2EE` | 243 242 238 | Cradle, wordmark, text, primary button |
| Tangerine bright | `#FF6B3D` | 255 107 61 | The dot on dark (6.3:1 on Night) |
| Stone dark | `#A3A6AD` | 163 166 173 | Secondary text, idle dot |
| Line | `#33363D` | 51 54 61 | Borders |

**Monochrome:** one color for everything (black, white, or the host’s text color).

## Typography

| Role | Font | Size / line | Tracking |
|---|---|---|---|
| Wordmark (logo only) | Nunito 900 | outlined in the logo files | +0.01em |
| Display | Plus Jakarta Sans 800 | 40/44 | −0.02em |
| Popup title | Plus Jakarta Sans 800 | 21/28 | −0.01em |
| Section label | Inter 600 | 13/18 | 0 |
| Body | Inter 400 | 15/22 | 0 |
| Button | Inter 600 | 15/20 (14 compact) | 0 |
| Meta | Inter 400 | 13/18 | 0 |

All three fonts are free under the SIL Open Font License. The extension bundles them from the Fontsource variable packages (`@fontsource-variable/inter`, `plus-jakarta-sans`, `nunito`), so it never loads fonts from the web. Fallback: `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`. The expansion “Bring Your Own Agent” is set in Plus Jakarta Sans 600 at 40% of the wordmark height.

## “Connect BYOA” button

- **Label:** always “Connect BYOA”. Once connected, show “{Profile} · Connected” or “{Profile} · Working…”.
- **Default:** 40 h, radius 10, padding 0 14 0 12, gap 8, 16 px symbol.
- **Compact:** 32 h, radius 8, padding 0 12 0 10, gap 6.
- **Variants:** ink (default), outline (busy toolbars), chalk (dark apps), status pill (connected).
- **Host apps may** match their own corner radius and font. **They may not** recolor the symbol, drop the label, or add “secure” or “verified”.

## Popup and voice

1. Show the requesting site’s address first.
2. Ask one question per screen: “Connect your agent to {App}?”
3. Pre-select the last profile used, but never connect without a click.
4. List what the app can and can’t do in everyday words.
5. Say plainly that results come from the agent, not BYOA.
6. Use “Connect” and “Not now” as the buttons. Avoid “Trust”, “Approve all” and “Verified”.

Avoid: secure, certified, guaranteed, magic, AI-powered. Prefer: your agent, connect, choose, disconnect anytime.

## Don’t

No shields or badges · no sparkles · no recoloring to host brands · no stretching or redrawing · tangerine never on text.
