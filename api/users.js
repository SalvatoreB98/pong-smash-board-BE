import supabase from "../services/db";
import Cors from "cors";

// Initialize CORS middleware
const cors = Cors({
  methods: ["GET", "POST", "OPTIONS"],
});

// Vercel API handler
export default async function handler(req, res) {
  await new Promise((resolve, reject) => {
    cors(req, res, (result) => (result instanceof Error ? reject(result) : resolve(result)));
  });

  if (req.method === "GET") {
    const { data, error } = await supabase.from("users").select("*");
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  return res.status(405).json({ error: "Method not allowed" });
}
