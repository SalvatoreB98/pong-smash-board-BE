export function parseData(matches) {

    if (!Array.isArray(matches)) {
        throw new Error("parseData expects an array, but received something else.");
    }

    return calculateStats(matches);
}

// ✅ Calculate statistics for matches
function calculateStats(matches) {
    let wins = {};
    let totPlayed = {};
    let points = {};
    let monthlyWinRates = {};
    let badges = {};

    // Initialize structures
    matches.forEach(({ player1_id, player2_id, player1_score, player2_score, created }) => {
        const month = created.split('-')[1]; // Extract month from timestamp

        [player1_id, player2_id].forEach(player => {
            if (!wins[player]) wins[player] = 0;
            if (!totPlayed[player]) totPlayed[player] = 0;
            if (!monthlyWinRates[player]) monthlyWinRates[player] = {};
            if (!badges[player]) badges[player] = [];
        });

        // Update stats
        totPlayed[player1_id] += player1_score + player2_score;
        totPlayed[player2_id] += player1_score + player2_score;
        wins[player1_id] += player1_score;
        wins[player2_id] += player2_score;

        // Monthly tracking
        if (!monthlyWinRates[player1_id][month]) monthlyWinRates[player1_id][month] = { wins: 0, totPlayed: 0 };
        if (!monthlyWinRates[player2_id][month]) monthlyWinRates[player2_id][month] = { wins: 0, totPlayed: 0 };

        monthlyWinRates[player1_id][month].wins += player1_score;
        monthlyWinRates[player1_id][month].totPlayed += player1_score + player2_score;
        monthlyWinRates[player2_id][month].wins += player2_score;
        monthlyWinRates[player2_id][month].totPlayed += player1_score + player2_score;
    });

    // Calculate points & badges
    points = calculatePoints(wins, totPlayed);
    monthlyWinRates = calculateMonthlyWinRates(monthlyWinRates);
    badges = calculateBadges(matches, wins, totPlayed, monthlyWinRates); // ✅ Now passing monthlyWinRates

    return { matches, wins, totPlayed, points, monthlyWinRates, badges };
}

// ✅ Calculate win percentages
function calculatePoints(wins, totPlayed) {
    return Object.keys(wins).reduce((acc, player) => {
        acc[player] = ((wins[player] / totPlayed[player]) * 100 || 0).toFixed(1);
        return acc;
    }, {});
}

// ✅ Calculate win rates per month
function calculateMonthlyWinRates(monthlyWinRates) {
    return Object.keys(monthlyWinRates).reduce((acc, player) => {
        acc[player] = Object.keys(monthlyWinRates[player]).reduce((months, month) => {
            const { wins, totPlayed } = monthlyWinRates[player][month];
            months[month] = ((wins / totPlayed) * 100 || 0).toFixed(1);
            return months;
        }, {});
        return acc;
    }, {});
}

// ✅ Assign badges based on performance
function calculateBadges(matches, wins, totPlayed, monthlyWinRates) { // ✅ Now accepting monthlyWinRates
    let badges = {};
    let totalLosses = {};
    let winStreaks = {};
    let currentStreaks = {};

    Object.keys(wins).forEach(player => {
        badges[player] = [];
        totalLosses[player] = totPlayed[player] - wins[player];
        winStreaks[player] = 0;
        currentStreaks[player] = 0;
    });

    matches.forEach(({ player1_id, player2_id, player1_score, player2_score }) => {
        if (player1_score > player2_score) {
            currentStreaks[player1_id]++;
            currentStreaks[player2_id] = 0;
        } else if (player2_score > player1_score) {
            currentStreaks[player2_id]++;
            currentStreaks[player1_id] = 0;
        }

        Object.keys(currentStreaks).forEach(player => {
            winStreaks[player] = Math.max(winStreaks[player], currentStreaks[player]);
        });
    });

    // Assign special badges
    assignBadge(badges, monthlyChampions(monthlyWinRates), "CHAMPION_OF_THE_MONTH");
    assignBadge(badges, getTopPlayer(totPlayed), "MAX_TOTAL");
    assignBadge(badges, getTopPlayer(totalLosses), "MAX_LOSSES");
    assignBadge(badges, getTopPlayer(winStreaks), "MAX_WIN_STREAK");

    return badges;
}

// ✅ Helper function to find top-performing player
function getTopPlayer(stat) {
    return Object.entries(stat).reduce((a, b) => (b[1] > a[1] ? b : a), [null, 0])[0];
}

// ✅ Find monthly champions
function monthlyChampions(monthlyWinRates) {
    let champions = {};
    Object.keys(monthlyWinRates).forEach(month => {
        champions[month] = getTopPlayer(monthlyWinRates[month]);
    });
    return champions;
}

// ✅ Assign badge to a player
function assignBadge(badges, player, badge) {
    if (player && badges.lenght) {
        badges[player].push(badge);
    }
}
