# spam_botme

This project contains a WhatsApp bot and now also includes a Telegram bot.

Running `node index.js` will start both bots. The Telegram bot helps manage the
`blacklist.json` file that is shared with the WhatsApp bot.

### Telegram Commands

- `/start` – display information and available commands.
- `/blacklist` – view the blacklist with simple pagination.
- `/add` – add a phone number to the blacklist.
- `/remove` – remove a phone number from the blacklist.

Numbers can be sent in local or international format (e.g. `0501234567` or
`972501234567`).

The WhatsApp bot periodically checks pending join requests in all managed
groups. Requests from numbers found in `blacklist.json` are rejected while all
others are approved automatically.
