// Temporary fix for WhatsApp Web.js participant removal issue
// This function works around the compatibility problem

async function removeUserFromGroupFixed(client, phoneNumber, groupId) {
    try {
        // Format the phone number
        const formattedNumber = phoneNumber.replace(/[^\d]/g, '');
        const participantId = formattedNumber.includes('@') ? formattedNumber : `${formattedNumber}@c.us`;
        
        console.log(`Attempting to remove ${participantId} from ${groupId}`);
        
        // Use direct evaluation to bypass WhatsApp Web.js wrapper
        const result = await client.pupPage.evaluate(async (gId, pId) => {
            try {
                // Get the chat using internal WhatsApp methods
                const chat = window.Store.Chat.get(gId);
                if (!chat) throw new Error('Chat not found');
                
                // Get the current participants
                const participants = chat.groupMetadata?.participants;
                if (!participants) throw new Error('No participants found');
                
                // Find the participant
                const participant = participants.find(p => 
                    p.id === pId || 
                    p.id._serialized === pId ||
                    p.id.user === pId.replace('@c.us', '')
                );
                
                if (!participant) throw new Error('Participant not found in group');
                
                // Use the internal WhatsApp store method directly
                const wid = window.Store.WidFactory.createWid(participant.id);
                await window.Store.GroupUtils.removeParticipants(chat.id, [wid]);
                
                return { success: true, message: 'Participant removed successfully' };
            } catch (error) {
                return { success: false, error: error.message };
            }
        }, groupId, participantId);
        
        return result;
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// Updated kickUserFromAllGroups function
async function kickUserFromAllGroupsFixed(client, rawNumber) {
    const e164 = formatPhoneNumberToE164(rawNumber);
    if (!e164) {
        return { success: false, error: 'invalid_number' };
    }
    
    const results = {
        success: true,
        phoneNumber: e164,
        removedFromGroups: 0,
        failedGroups: 0,
        groupsNotAdmin: 0,
        totalDeletedMessages: 0,
        groupResults: []
    };
    
    const groups = Array.from(botConfig.managedGroups || []);
    
    for (const groupId of groups) {
        try {
            const chat = await client.getChatById(groupId);
            const groupName = chat.name || groupId;
            
            // Check if bot is admin
            if (!(await isGroupAdmin(client, groupId))) {
                results.groupsNotAdmin++;
                results.groupResults.push({ 
                    group: groupName, 
                    removed: false, 
                    error: 'bot_not_admin' 
                });
                continue;
            }
            
            // Try to remove user
            const removeResult = await removeUserFromGroupFixed(client, e164, groupId);
            
            if (removeResult.success) {
                results.removedFromGroups++;
                results.groupResults.push({ 
                    group: groupName, 
                    removed: true, 
                    error: '' 
                });
                
                // Try to delete messages
                try {
                    const msgs = await chat.fetchMessages({ limit: 100 });
                    for (const msg of msgs) {
                        if (msg.author === `${e164}@c.us` || msg.from === `${e164}@c.us`) {
                            try {
                                await msg.delete(true);
                                results.totalDeletedMessages++;
                            } catch (e) {}
                        }
                    }
                } catch (e) {}
                
            } else {
                results.failedGroups++;
                results.groupResults.push({ 
                    group: groupName, 
                    removed: false, 
                    error: removeResult.error 
                });
            }
            
        } catch (error) {
            results.failedGroups++;
            results.groupResults.push({ 
                group: groupId, 
                removed: false, 
                error: error.message 
            });
        }
    }
    
    // Add to blacklist
    if (typeof addToBlacklist === 'function') {
        addToBlacklist(`${e164}@c.us`);
    }
    
    return results;
}

// Export the functions
module.exports = {
    removeUserFromGroupFixed,
    kickUserFromAllGroupsFixed
};