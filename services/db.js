const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl) {
    throw new Error('Missing SUPABASE_URL environment variable');
}

const supabaseKey = supabaseServiceKey || supabaseAnonKey;

if (!supabaseKey) {
    throw new Error('Missing Supabase key. Provide SUPABASE_SERVICE_KEY or SUPABASE_ANON_KEY.');
}

const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false,
    },
});

module.exports = supabase;
