// Updating the createCreditTopUpSession function to include topUpAmount and fee in the metadata.
function createCreditTopUpSession(userId, topUpAmount, fee) {
    const metadata = {
        userId: userId,
        topUpAmount: topUpAmount,
        fee: fee
    };
    // existing code to handle session creation
    // ...
}