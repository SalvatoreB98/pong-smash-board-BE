export const formatDateForDB = (dateString) => {
    const parsedDate = dateString.includes('-') // Check if the format is `16/02/2025 - 16:36`
        ? dateString.split(' - ')[0].split('/').reverse().join('-') + 'T' + dateString.split(' - ')[1] + ':00Z'
        : dateString; // If already correct, use as is

    return new Date(parsedDate).toISOString(); // Convert to ISO format
};