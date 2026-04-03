import Shop from "../models/shop.model.js";

/**
 * Checks if a shop is currently open based on business hours and temporary closures.
 * @param {Object} shop The shop document (must have businessHours and temporaryClosure populated)
 * @returns {Object} { isOpen: boolean, reason: string }
 */
export const getShopStatus = (shop) => {
  if (!shop) return { isOpen: false, reason: "Shop not found" };

  // 1. Check Approval
  if (shop.isApproved !== true) {
    return { isOpen: false, reason: "Restaurant is not approved yet." };
  }

  // 2. Check Temporary Closure
  if (shop.temporaryClosure?.isClosed === true) {
    return { isOpen: false, reason: "Restaurant is temporarily closed." };
  }

  // 3. Check Business Hours
  const businessHours = shop.businessHours;
  if (!businessHours || !Array.isArray(businessHours) || businessHours.length === 0) {
    return { isOpen: true, reason: "No business hours set" };
  }

  const now = new Date();
  const dayNames = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  const currentDay = dayNames[now.getDay()];
  const currentTimeInMinutes = now.getHours() * 60 + now.getMinutes();

  const todayHours = businessHours.find((h) => h && h.day === currentDay);
  if (!todayHours) return { isOpen: true, reason: "Hours not found for today" };
  if (todayHours.isClosed === true) return { isOpen: false, reason: "Closed today" };

  if (
    todayHours.timeSlots &&
    Array.isArray(todayHours.timeSlots) &&
    todayHours.timeSlots.length > 0
  ) {
    for (const slot of todayHours.timeSlots) {
      if (slot.is24Hours) return { isOpen: true, reason: "Open 24 hours" };
      if (!slot.openTime || !slot.closeTime) continue;

      const [openHour, openMin] = slot.openTime.split(":").map(Number);
      const [closeHour, closeMin] = slot.closeTime.split(":").map(Number);
      
      if (isNaN(openHour) || isNaN(openMin) || isNaN(closeHour) || isNaN(closeMin)) continue;

      const openTimeInMinutes = openHour * 60 + openMin;
      const closeTimeInMinutes = closeHour * 60 + closeMin;

      let isWithinSlot = false;
      // Handle overnight slots (e.g., 22:00 to 02:00)
      if (closeTimeInMinutes < openTimeInMinutes) {
        isWithinSlot =
          currentTimeInMinutes >= openTimeInMinutes ||
          currentTimeInMinutes <= closeTimeInMinutes;
      } else {
        isWithinSlot =
          currentTimeInMinutes >= openTimeInMinutes &&
          currentTimeInMinutes < closeTimeInMinutes;
      }

      if (isWithinSlot) return { isOpen: true, reason: "Currently within open slot" };
    }
    return { isOpen: false, reason: "Currently outside of open slots" };
  }

  // Fallback to legacy single open/close time if timeSlots are missing
  if (todayHours.openTime && todayHours.closeTime) {
    const [openHour, openMin] = todayHours.openTime.split(":").map(Number);
    const [closeHour, closeMin] = todayHours.closeTime.split(":").map(Number);
    
    if (isNaN(openHour) || isNaN(openMin) || isNaN(closeHour) || isNaN(closeMin)) {
      return { isOpen: true, reason: "Invalid open/close time format" };
    }

    const openTimeInMinutes = openHour * 60 + openMin;
    const closeTimeInMinutes = closeHour * 60 + closeMin;

    let isOpenStatus = false;
    if (closeTimeInMinutes < openTimeInMinutes) {
      isOpenStatus =
        currentTimeInMinutes >= openTimeInMinutes ||
        currentTimeInMinutes <= closeTimeInMinutes;
    } else {
      isOpenStatus =
        currentTimeInMinutes >= openTimeInMinutes &&
        currentTimeInMinutes < closeTimeInMinutes;
    }
    return { isOpen: isOpenStatus, reason: isOpenStatus ? "Open" : "Currently closed" };
  }

  return { isOpen: true, reason: "Default open status" };
};
