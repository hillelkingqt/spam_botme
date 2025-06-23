// remove-user-fix.js
module.exports = (dependencies) => {
    const { log, logError, formatPhoneNumberToE164, isGroupAdmin, addToBlacklist, botConfig } = dependencies;
    const STAGE_PREFIX = "REMOVE_USER_FIX";

    async function removeUserFromGroupFixed(client, phoneNumber, groupId) {
        const stage = `${STAGE_PREFIX}_SINGLE_GROUP[${groupId}]`;
        log(`Attempting fixed removal of ${phoneNumber} from group ${groupId}`, stage);
        try {
            const formattedNumber = phoneNumber.replace(/[^\d]/g, '');
            const participantId = formattedNumber.includes('@') ? formattedNumber : `${formattedNumber}@c.us`;
            log(`Formatted participantId: ${participantId} for removal from ${groupId}`, stage);

            const result = await client.pupPage.evaluate(async (gId, pId) => {
                try {
                    const chat = window.Store.Chat.get(gId);
                    if (!chat) throw new Error('Store: Chat not found');

                    const groupMetadata = chat.groupMetadata;
                    if (!groupMetadata || !groupMetadata.participants) throw new Error('Store: No participants found in group metadata');

                    const participants = groupMetadata.participants.getModelsArray ? groupMetadata.participants.getModelsArray() : groupMetadata.participants;

                    const participant = participants.find(p =>
                        p.id === pId ||
                        p.id._serialized === pId ||
                        p.id.user === pId.replace('@c.us', '')
                    );

                    if (!participant) throw new Error(`Store: Participant ${pId} not found in group`);

                    const wid = window.Store.WidFactory.createWid(participant.id._serialized || participant.id);
                    await window.Store.GroupUtils.removeParticipants(chat.id, [wid]);
                    return { success: true, message: `Store: Participant ${pId} removed successfully` };
                } catch (error) {
                    return { success: false, error: error.message, stack: error.stack };
                }
            }, groupId, participantId);

            if (result.success) {
                log(`Successfully removed ${participantId} from ${groupId} using fixed Store method. Message: ${result.message}`, stage);
            } else {
                logError(`Failed to remove ${participantId} from ${groupId} using fixed Store method: ${result.error}`, stage, result.stack ? { message: result.error, stack: result.stack } : new Error(result.error));
            }
            return result;
        } catch (error) {
            logError(`Critical error in removeUserFromGroupFixed for ${phoneNumber} from ${groupId}: ${error.message}`, stage, error);
            return { success: false, error: error.message };
        }
    }

    async function kickUserFromAllGroupsFixed(client, rawNumber) {
        const stage = `${STAGE_PREFIX}_KICK_ALL[${rawNumber}]`;
        log(`Starting fixed kick for user ${rawNumber} from all managed groups.`, stage);

        const e164 = formatPhoneNumberToE164(rawNumber);
        if (!e164) {
            logError(`Invalid raw number ${rawNumber} provided. Cannot format to E164.`, stage);
            return { success: false, error: 'invalid_number_format' };
        }
        log(`Formatted number ${rawNumber} to E164: ${e164}`, stage);

        const results = {
            success: true, phoneNumber: e164, removedFromGroups: 0, failedGroups: 0,
            groupsNotAdmin: 0, totalDeletedMessages: 0, groupResults: []
        };
        
        const groupsToProcess = Array.from(botConfig.managedGroups || []);
        log(`Will process ${groupsToProcess.length} managed groups.`, stage);
        
        for (const groupId of groupsToProcess) {
            const groupStage = `${stage}_GROUP[${groupId}]`;
            let groupName = groupId;
            try {
                const chat = await client.getChatById(groupId);
                groupName = chat.name || groupId;
                log(`Processing group ${groupName} for removal of ${e164}.`, groupStage);
                
                if (!(await isGroupAdmin(client, groupId))) { // isGroupAdmin now has its own logging
                    log(`Bot is not admin in ${groupName}. Skipping.`, groupStage);
                    results.groupsNotAdmin++;
                    results.groupResults.push({ group: groupName, removed: false, error: 'bot_not_admin' });
                    continue;
                }
                
                const removeResult = await removeUserFromGroupFixed(client, e164, groupId); // This function now logs
                
                if (removeResult.success) {
                    log(`Successfully removed ${e164} from ${groupName}.`, groupStage);
                    results.removedFromGroups++;
                    results.groupResults.push({ group: groupName, removed: true, error: '' });

                    const wipeStage = `${groupStage}_MSG_WIPE`;
                    log(`Attempting to delete messages for ${e164} in ${groupName}.`, wipeStage);
                    try {
                        const msgs = await chat.fetchMessages({ limit: 100 });
                        let wipedCountThisGroup = 0;
                        for (const msg of msgs) {
                            if (msg.author === `${e164}@c.us` || msg.from === `${e164}@c.us`) {
                                try {
                                    await msg.delete(true);
                                    results.totalDeletedMessages++;
                                    wipedCountThisGroup++;
                                } catch (e) {
                                    logError(`Failed to delete message ${msg.id._serialized} from ${e164} in ${groupName}: ${e.message}`, wipeStage, e);
                                }
                            }
                        }
                        log(`Wiped ${wipedCountThisGroup} messages for ${e164} in ${groupName}.`, wipeStage);
                    } catch (e) {
                        logError(`Error fetching messages for wipe in ${groupName}: ${e.message}`, wipeStage, e);
                    }
                } else {
                    logError(`Failed to remove ${e164} from ${groupName}. Error: ${removeResult.error}`, groupStage);
                    results.failedGroups++;
                    results.groupResults.push({ group: groupName, removed: false, error: removeResult.error });
                }
            } catch (error) {
                logError(`Error processing group ${groupName} for user ${e164}: ${error.message}`, groupStage, error);
                results.failedGroups++;
                results.groupResults.push({ group: groupName, removed: false, error: error.message });
            }
        }

        if (typeof addToBlacklist === 'function') {
            log(`Adding ${e164}@c.us to blacklist after processing all groups.`, stage);
            addToBlacklist(`${e164}@c.us`); // addToBlacklist has its own logging
        } else {
            logError("addToBlacklist function not available in remove-user-fix module.", stage);
        }

        log(`Finished fixed kick process for ${rawNumber}. Results: ${JSON.stringify(results, null, 2)}`, stage);
        return results;
    }

    return {
        removeUserFromGroupFixed,
        kickUserFromAllGroupsFixed
    };
};