// join-requests.js
module.exports = (log, logError) => {
    const STAGE_PREFIX = "JOIN_REQUESTS";

    function handleJoinRequest(client, message, senderId) {
        const stage = `${STAGE_PREFIX}_HANDLE_REQUEST`;
        log(`Received join request from ${senderId}. Message: "${message.body}"`, stage);
        // Actual implementation would go here.
        // For now, just logging the call.
        log(`Placeholder: handleJoinRequest called for ${senderId}`, stage);
    }

    function handleJoinTestResponse(client, message, senderId) {
        const stage = `${STAGE_PREFIX}_HANDLE_RESPONSE`;
        log(`Received test response from ${senderId}. Message: "${message.body}"`, stage);
        // Actual implementation would go here.
        // For now, just logging the call.
        log(`Placeholder: handleJoinTestResponse called for ${senderId}`, stage);
    }

    function hasActiveJoinTest(senderId) {
        const stage = `${STAGE_PREFIX}_CHECK_ACTIVE_TEST`;
        // Actual implementation might check a map or database.
        // For now, returning false and logging.
        const isActive = false; // Replace with actual check
        log(`Checking for active join test for ${senderId}. Is active: ${isActive}`, stage);
        return isActive;
    }

    return {
        handleJoinRequest,
        handleJoinTestResponse,
        hasActiveJoinTest
    };
};
