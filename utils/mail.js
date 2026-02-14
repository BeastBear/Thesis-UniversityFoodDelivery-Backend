import nodemailer from "nodemailer";
import dotenv from "dotenv";
dotenv.config();

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL,
    pass: process.env.PASS,
  },
});

export const sendOtpMail = async (to, otp) => {
  await transporter.sendMail({
    from: process.env.EMAIL,
    to,
    subject: "Reset Your Password",
    html: `<p>Your OTP for password reset is <b>${otp}</b>. It expires in 5 minutes.</p>`,
  });
};

export const sendDeliveryOtpMail = async (to, otp) => {
  await transporter.sendMail({
    from: process.env.EMAIL,
    to,
    subject: "Delivery OTP",
    html: `<p>Your delivery OTP is <b>${otp}</b>. It expires in 10 minutes.</p>`,
  });
};