const express = require('express');
const twilio = require('twilio');
const sqlite3 = require('sqlite3').verbose();
const dotenv = require('dotenv');

dotenv.config();

const app = express();

// Initialize Twilio client
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// Initialize SQLite database
const db = new sqlite3.Database('./sms.db', (err) => {
    if (err) {
        console.error('Error connecting to SQLite database:', err.message);
    } else {
        console.log('Connected to SQLite database.');
        db.run(`
            CREATE TABLE IF NOT EXISTS sms (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                to_number TEXT NOT NULL,
                message TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
    }
});

// Middleware to parse JSON
app.use(express.json());

// Endpoint to send SMS
app.post('/send-sms', async (req, res) => {
    const { to, message } = req.body;

    if (!to || !message) {
        return res.status(400).json({ error: 'Missing "to" or "message" in request body.' });
    }

    try {
        // Save SMS to database with status "pending"
        db.run(
            'INSERT INTO sms (to_number, message, status) VALUES (?, ?, ?)',
            [to, message, 'pending'],
            function (err) {
                if (err) {
                    console.error('Error saving SMS to database:', err.message);
                    return res.status(500).json({ error: 'Failed to save SMS.' });
                }

                const smsId = this.lastID;

                // Send SMS using Twilio
                client.messages
                    .create({
                        body: message,
                        from: process.env.TWILIO_PHONE_NUMBER,
                        to: to,
                    })
                    .then((message) => {
                        // Update SMS status to "sent"
                        db.run(
                            'UPDATE sms SET status = ? WHERE id = ?',
                            ['sent', smsId],
                            (err) => {
                                if (err) {
                                    console.error('Error updating SMS status:', err.message);
                                }
                            }
                        );

                        res.status(200).json({
                            message: 'SMS sent successfully!',
                            sid: message.sid,
                        });
                    })
                    .catch((err) => {
                        // Update SMS status to "failed"
                        db.run(
                            'UPDATE sms SET status = ? WHERE id = ?',
                            ['failed', smsId],
                            (err) => {
                                if (err) {
                                    console.error('Error updating SMS status:', err.message);
                                }
                            }
                        );

                        res.status(500).json({ error: 'Failed to send SMS.', details: err.message });
                    });
            }
        );
    } catch (err) {
        console.error('Error sending SMS:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// Endpoint to track SMS status
app.get('/track-sms/:id', (req, res) => {
    const smsId = req.params.id;

    db.get('SELECT * FROM sms WHERE id = ?', [smsId], (err, row) => {
        if (err) {
            console.error('Error fetching SMS:', err.message);
            return res.status(500).json({ error: 'Failed to fetch SMS.' });
        }

        if (!row) {
            return res.status(404).json({ error: 'SMS not found.' });
        }

        res.status(200).json(row);
    });
});

// Start the server
app.listen(80,() => {
    console.log(`Server running on http://localhost`);
});
