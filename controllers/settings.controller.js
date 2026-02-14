import SystemSettings from "../models/systemSettings.model.js";

export const getPublicSettings = async (req, res) => {
  try {
    let settings = await SystemSettings.findOne()
      .select(
        "cafeteriaSettings isSystemOpen maintenanceMode deliveryZoneId commissionPercentage baseDeliveryFee pricePerKm announcementBanner",
      )
      .populate("deliveryZoneId")
      .populate("cafeteriaSettings.zoneId");

    if (!settings) {
      // Return default if no settings exist
      return res.status(200).json({
        cafeteriaSettings: [],
        isSystemOpen: true,
        maintenanceMode: false,
        commissionPercentage: 0,
        baseDeliveryFee: 0,
        pricePerKm: 5,
        announcementBanner: "",
      });
    }

    res.status(200).json(settings);
  } catch (error) {
    res
      .status(500)
      .json({ message: `Get public settings error: ${error.message}` });
  }
};
