const supabase = require("../services/db");
require("dotenv").config();

module.exports = async (req, res) => {
    if (req.method !== "GET") {
        return res.status(405).json({ error: "Method Not Allowed" });
    }

    try {
        const { data, error } = await supabase.from("players").select("*");

        if (error) {
            throw error;
        }

        if (!data || data.length === 0) {
            return res.status(404).json({ error: "No players found." });
        }

        res.status(200).json(data);
    } catch (error) {
        console.error("Error fetching players:", error);
        res.status(500).json({ error: "Failed to fetch players." });
    }
};
