// /api/add-competition.js
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const applyCors = require('./cors');

// opzionale: se hai già una util per le date, riusala
const { formatDateForDB } = require('../utils/utils');
const normalizeDate = (d) => {
    if (!d) return null;
    try { return formatDateForDB ? formatDateForDB(d) : new Date(d).toISOString().slice(0, 10); }
    catch { return null; }
};

module.exports = (req, res) => {
    applyCors(req, res, async () => {
        if (req.method !== 'POST') {
            return res.status(405).json({ error: 'Method Not Allowed' });
        }

        try {
            const {
                name,
                type,        // 'league' | 'elimination' | altro testo ammesso dalla tabella
                bestOf,      // -> setsType (es. 3, 5, 7)
                pointsTo,    // -> pointsType (es. 11, 21)
                startDate,   // opzionale, ISO/string
                endDate      // opzionale, ISO/string
            } = req.body || {};

            // ✅ Validazioni base
            if (!name || !type || bestOf == null || pointsTo == null) {
                return res.status(400).json({
                    error: 'Invalid data. Required: name, type, bestOf, pointsTo.'
                });
            }
            if (typeof bestOf !== 'number' || typeof pointsTo !== 'number') {
                return res.status(400).json({ error: 'bestOf and pointsTo must be numbers.' });
            }

            // ✅ Prepara il record da inserire
            const payload = {
                name: String(name).trim(),
                type: String(type).trim(),
                setsType: bestOf,
                pointsType: pointsTo,
                start_date: normalizeDate(startDate),
                end_date: normalizeDate(endDate)
            };

            // ✅ Insert nella tabella (es. "competitions")
            const { data: competition, error } = await supabase
                .from('competitions')            // <-- usa il nome della tua tabella qui
                .insert([payload])
                .select()
                .single();

            if (error) throw error;

            return res.status(201).json({
                message: 'Competition created successfully',
                competition
            });
        } catch (err) {
            console.error('Error inserting competition:', err.message || err);
            return res.status(500).json({ error: 'Failed to create competition' });
        }
    });
};
