# spam_botme

This project contains a WhatsApp bot and now also includes a Telegram bot.

Running `node index.js` will start both bots. The Telegram bot helps manage the
`blacklist.json` file that is shared with the WhatsApp bot.

Whenever numbers are added or removed from the blacklist through the Telegram
bot the WhatsApp bot is automatically restarted so it reloads the updated list.

### Telegram Commands

- `/start` – display information and available commands.
- `/blacklist` – view the blacklist with simple pagination.
- `/add` – add a phone number to the blacklist.
- `/remove` – remove a phone number from the blacklist.

Numbers can be sent in local or international format (e.g. `0501234567` or
`972501234567`).
