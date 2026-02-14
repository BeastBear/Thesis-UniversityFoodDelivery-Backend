import TicketSubject from "../models/ticketSubject.model.js";

export const listActiveTicketSubjects = async (req, res) => {
  try {
    const subjects = await TicketSubject.find({ isActive: true })
      .sort({ sortOrder: 1, subject: 1 })
      .select("subject category priority sortOrder");

    return res.status(200).json(subjects);
  } catch (error) {
    return res
      .status(500)
      .json({ message: `List ticket subjects error: ${error.message}` });
  }
};

export const adminListTicketSubjects = async (req, res) => {
  try {
    const subjects = await TicketSubject.find().sort({ sortOrder: 1, subject: 1 });
    return res.status(200).json(subjects);
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Admin list ticket subjects error: ${error.message}` });
  }
};

export const adminCreateTicketSubject = async (req, res) => {
  try {
    const { subject, category, priority, isActive, sortOrder } = req.body;

    const created = await TicketSubject.create({
      subject,
      category,
      priority,
      isActive,
      sortOrder,
    });

    return res.status(201).json({ message: "Ticket subject created", subject: created });
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Admin create ticket subject error: ${error.message}` });
  }
};

export const adminUpdateTicketSubject = async (req, res) => {
  try {
    const { subjectId } = req.params;
    const { subject, category, priority, isActive, sortOrder } = req.body;

    const updated = await TicketSubject.findByIdAndUpdate(
      subjectId,
      { subject, category, priority, isActive, sortOrder },
      { new: true },
    );

    if (!updated) {
      return res.status(404).json({ message: "Ticket subject not found" });
    }

    return res.status(200).json({ message: "Ticket subject updated", subject: updated });
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Admin update ticket subject error: ${error.message}` });
  }
};

export const adminDeleteTicketSubject = async (req, res) => {
  try {
    const { subjectId } = req.params;

    const deleted = await TicketSubject.findByIdAndDelete(subjectId);
    if (!deleted) {
      return res.status(404).json({ message: "Ticket subject not found" });
    }

    return res.status(200).json({ message: "Ticket subject deleted" });
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Admin delete ticket subject error: ${error.message}` });
  }
};
