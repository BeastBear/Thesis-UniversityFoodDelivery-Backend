import Shop from "../models/shop.model.js";

// Helper function to clear expired temporary closures
export const clearExpiredClosures = async (shop) => {
  if (shop.temporaryClosure?.isClosed) {
    const now = new Date();
    let shouldClear = false;
    
    // Check if closedUntil has passed
    if (shop.temporaryClosure.closedUntil) {
      const closedUntil = new Date(shop.temporaryClosure.closedUntil);
      // Add a small buffer (1 second) to account for timing differences
      if (now.getTime() > closedUntil.getTime() + 1000) {
        shouldClear = true;
      }
    } else if (shop.temporaryClosure.reopenTime) {
      // If only reopenTime is set (shouldn't happen, but handle it)
      const [hour, minute] = shop.temporaryClosure.reopenTime.split(":").map(Number);
      if (!isNaN(hour) && !isNaN(minute)) {
        const reopenTimeToday = new Date(now);
        reopenTimeToday.setHours(hour, minute, 0, 0);
        
        // If current time is past the reopen time today, clear the closure
        if (now.getTime() >= reopenTimeToday.getTime()) {
          shouldClear = true;
        }
      }
    }
    
    if (shouldClear) {
      shop.temporaryClosure = {
        isClosed: false,
        reopenTime: null,
        closedUntil: null,
      };
      await shop.save();
    }
  }
  
  // Also check and remove expired special holidays (optional cleanup)
  if (shop.specialHolidays && Array.isArray(shop.specialHolidays)) {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const originalLength = shop.specialHolidays.length;
    shop.specialHolidays = shop.specialHolidays.filter(holiday => {
      const endDate = new Date(holiday.endDate);
      endDate.setHours(23, 59, 59, 999);
      // Keep holidays that haven't ended yet (or ended today)
      return endDate >= now;
    });
    
    // If holidays were removed, save the shop
    if (shop.specialHolidays.length !== originalLength) {
      await shop.save();
    }
  }
  
  return shop;
};


