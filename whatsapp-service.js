const express = require('express');
const twilio = require('twilio');
const sqlite3 = require('sqlite3').verbose();
const dotenv = require('dotenv');

dotenv.config();

const router = express.Router();
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// Connect to SQLite Database
const db = new sqlite3.Database('./sms.db', (err) => {
    if (err) {
        console.error('Error connecting to SQLite database:', err.message);
    } else {
        console.log('Connected to SQLite database.');
        db.run(`
            CREATE TABLE IF NOT EXISTS whatsapp (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                to_number TEXT NOT NULL,
                message TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
    }
});

router.use(express.json());

// Function to insert message into DB (returns a Promise)
const insertMessage = (to, message) => {
    return new Promise((resolve, reject) => {
        db.run(
            'INSERT INTO whatsapp (to_number, message, status) VALUES (?, ?, ?)',
            [to, message, 'pending'],
            function (err) {
                if (err) reject(err);
                else resolve(this.lastID);
            }
        );
    });
};

// Function to update message status in DB (returns a Promise)
const updateMessageStatus = (id, status) => {
    return new Promise((resolve, reject) => {
        db.run(
            'UPDATE whatsapp SET status = ? WHERE id = ?',
            [status, id],
            (err) => {
                if (err) reject(err);
                else resolve();
            }
        );
    });
};

// API to send WhatsApp message
router.post('/send-whatsapp', async (req, res) => {
    const { to, message } = req.body;
    if (!to || !message) {
        return res.status(400).json({ error: 'Missing "to" or "message" in request body.' });
    }

    const formattedTo = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;

    try {
        // Insert message into DB
        const messageId = await insertMessage(formattedTo, message);

        // Send WhatsApp message via Twilio
        const twilioMessage = await client.messages.create({
            body: message,
            from: process.env.TWILIO_WHATSAPP_NUMBER,
            to: formattedTo
        });

        // Update status to 'sent'
        await updateMessageStatus(messageId, 'sent');

        res.status(200).json({ message: 'Message sent!', sid: twilioMessage.sid });
    } catch (err) {
        console.error('Error:', err.message);
        
        // Update status to 'failed' in case of error
        if (err && err.messageId) {
            await updateMessageStatus(err.messageId, 'failed');
        }

        res.status(500).json({ error: 'Failed to send message.', details: err.message });
    }
});

// API to track message status
router.get('/track-whatsapp/:id', (req, res) => {
    const messageId = req.params.id;
    db.get('SELECT * FROM whatsapp WHERE id = ?', [messageId], (err, row) => {
        if (err) {
            console.error('Error fetching message:', err.message);
            return res.status(500).json({ error: 'Failed to fetch message.' });
        }
        if (!row) {
            return res.status(404).json({ error: 'Message not found.' });
        }
        res.status(200).json(row);
    });
});

module.exports = router;
