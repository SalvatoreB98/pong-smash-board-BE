module.exports = (req, res, next) => {
    const allowedOrigins = ['http://localhost:4200', 'https://your-frontend.vercel.app'];
    const origin = req.headers.origin;

    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }

    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // ✅ Handle preflight request & stop further execution
    if (req.method === 'OPTIONS') {
        return res.status(200).end(); // Ends the request here
    }

    next(); // ✅ Continue execution for normal requests
};