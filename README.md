# Kennel Booking (standalone)

Internal staff tool for dog-kennel reservations: kennels, dates, prices, check-in/out, history, JSON backup.

This folder is **independent from the public marketing website**. Copy only `booking/` to another machine or host.

## What it is

- Static HTML / CSS / JS (no backend, no database server)
- Staff-only UI protected by a PIN (`js/config.js`)
- Data stored in the browser `localStorage` on that device
- Languages: Armenian / Russian / English

## What it is not

- Not a public booking form for clients
- Not connected to Azure, cloud inbox, or any third-party API
- Not tied to a specific hotel brand or personal contact data

## Quick start (Windows)

1. Edit `js/config.js` (PIN, optional hotel name / phone / WhatsApp).
2. Double-click `start.bat`.
3. Browser opens `http://127.0.0.1:8080/`.
4. Enter the PIN from `config.js`.

Requires **Python 3** or **Node.js** on the machine (used only to serve static files).

## Deploy on a friend’s server / hosting

1. Upload the whole `booking/` directory.
2. Point the web root (or a subfolder) at this directory so `index.html` is served.
3. Open the URL, enter PIN.
4. Use **Export JSON** regularly — data lives in that browser only.

Any static host works (nginx, IIS, Apache, shared hosting, GitHub Pages, etc.).

## Configure

File: `js/config.js`

| Field | Purpose |
| --- | --- |
| `pin` | Staff login code |
| `staffWhatsApp` | Digits only, used as WhatsApp fallback when sharing a booking |
| `hotelName` | Name on printed / shared documents |
| `place` | Optional place line |
| `phoneDisplay` | Optional phone on documents |

Change the PIN before sharing the folder.

## Project layout

```
booking/
  index.html          App shell (staff-only)
  start.bat           Local static server launcher
  README.md
  favicon.svg
  css/
    style.css         Shared visual base
    booking.css       Booking UI
  js/
    config.js         Local settings (edit this)
    i18n.js           Translations (hy / ru / en)
    main.js           Tiny UI helpers
    booking.js        Booking logic
```

## Data & backup

- Bookings / settings / notifications → `localStorage`
- **Export JSON** / **Import JSON** in the UI for backup and migration
- Clearing site data in the browser deletes local bookings

## Security notes

- PIN is checked in the browser (deterrent, not strong server auth)
- Do not put this folder on a public marketing site without access control
- Do not commit real PIN / phone numbers to a public repository

## License / reuse

Generic standalone template. Fill `config.js` with your own details when you use it.
