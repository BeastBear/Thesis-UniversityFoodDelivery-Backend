import Zone from "../models/zone.model.js";

// Create a new zone
export const createZone = async (req, res) => {
  try {
    const { name, type, coordinates, description } = req.body;

    const existingZone = await Zone.findOne({ name });
    if (existingZone) {
      return res.status(400).json({ message: "Zone name already exists" });
    }

    const newZone = new Zone({
      name,
      type,
      coordinates,
      description,
    });

    await newZone.save();
    res.status(201).json(newZone);
  } catch (error) {
    res.status(500).json({ message: `Create zone error: ${error.message}` });
  }
};

// Get all zones
export const getZones = async (req, res) => {
  try {
    const zones = await Zone.find({});
    res.status(200).json(zones);
  } catch (error) {
    res.status(500).json({ message: `Get zones error: ${error.message}` });
  }
};

// Delete a zone
export const deleteZone = async (req, res) => {
  try {
    const { zoneId } = req.params;
    await Zone.findByIdAndDelete(zoneId);
    res.status(200).json({ message: "Zone deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: `Delete zone error: ${error.message}` });
  }
};
