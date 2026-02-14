import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
    password: {
      type: String,
    },
    mobile: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      enum: ["user", "owner", "deliveryBoy", "admin"],
      required: true,
    },
    isSuspended: {
      type: Boolean,
      default: false,
    },
    resetOtp: {
      type: String,
    },
    isOtpVerified: {
      type: Boolean,
      default: false,
    },
    otpExpires: {
      type: Date,
    },
    socketId: {
      type: String,
      default: null,
    },
    pushSubscription: {
      endpoint: String,
      keys: {
        p256dh: String,
        auth: String,
      },
    },
    ownerVerification: {
      status: {
        type: String,
        enum: ["unverified", "pending", "verified", "rejected"],
        default: "unverified",
      },
      rejectionReason: { type: String, default: "" },
      submittedAt: { type: Date, default: null },
      verifiedAt: { type: Date, default: null },
      owner: {
        fullName: { type: String, default: "" },
        email: { type: String, default: "" },
        mobile: { type: String, default: "" },
      },
      restaurant: {
        name: { type: String, default: "" },
        photo: { type: String, default: "" },
        cafeteria: { type: String, default: "" },
        restaurantNumber: { type: String, default: "" },
        description: { type: String, default: "" },
      },
      bank: {
        accountName: { type: String, default: "" },
        bank: { type: String, default: "" },
        branch: { type: String, default: "" },
        accountNumber: { type: String, default: "" },
        applicationId: { type: String, default: "" },
      },
      kyc: {
        fullName: { type: String, default: "" },
        idNumber: { type: String, default: "" },
        idFrontImage: { type: String, default: "" },
        idBackImage: { type: String, default: "" },
      },
      kyb: {
        businessType: {
          type: String,
          enum: ["individual", "company", ""],
          default: "",
        },
        commercialRegistration: { type: String, default: "" },
        storefrontPhoto: { type: String, default: "" },
        kitchenPhoto: { type: String, default: "" },
      },
      financial: {
        bookbankHeaderPhoto: { type: String, default: "" },
      },
      location: {
        address: { type: String, default: "" },
        latitude: { type: Number, default: null },
        longitude: { type: Number, default: null },
      },
    },
    isOnline: {
      type: Boolean,
      default: false,
    },
    profileImage: {
      type: String,
      default: "",
    },
    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number],
        default: [0, 0],
      },
    },
    currentAddress: {
      type: String,
      default: "",
    },
    savedAddresses: [
      {
        label: String,
        address: String,
        location: {
          lat: Number,
          lon: Number,
        },
        contactName: String,
        contactNumber: String,
        note: String,
        isDefault: { type: Boolean, default: false },
      },
    ],
    stripeCustomerId: {
      type: String,
      default: null,
    },
    savedCards: [
      {
        cardType: String, // visa, mastercard
        last4: String,
        cardNumber: String, // For demo only. In production use Stripe Customer ID
        expiry: String,
        cvv: String,
        cardholderName: String,
        nickname: String,
        isDefault: { type: Boolean, default: false },
        stripePaymentMethodId: { type: String, default: null },
      },
    ],
    defaultPaymentMethod: {
      type: String,
      enum: ["card", "promptpay", "cod"],
      default: "cod",
    },
    jobCredit: {
      type: Number,
      default: 0,
    },
    ePaymentAccount: {
      accountName: { type: String, default: "" },
      bank: { type: String, default: "" },
      branch: { type: String, default: "" },
      accountNumber: { type: String, default: "" },
      applicationId: { type: String, default: "" },
    },
    stripeConnectAccountId: {
      type: String,
      default: null,
    },
    stripeBankAccountId: {
      type: String,
      default: null,
    },
    deliveryVerification: {
      status: {
        type: String,
        enum: ["unverified", "pending", "verified", "rejected"],
        default: "unverified",
      },
      profile: {
        idNumber: { type: String, default: "" },
      },
      studentInfo: {
        studentIdNumber: { type: String, default: "" },
        faculty: { type: String, default: "" },
        major: { type: String, default: "" },
      },
      documents: {
        studentCard: { type: String, default: "" },
      },
      rejectionReason: { type: String, default: "" },
      submittedAt: { type: Date },
      verifiedAt: { type: Date },
    },
    payouts: [
      {
        payoutId: { type: String, required: true },
        amount: { type: Number, required: true },
        currency: { type: String, default: "thb" },
        status: {
          type: String,
          enum: [
            "pending",
            "in_transit",
            "paid",
            "canceled",
            "failed",
            "on_hold",
          ],
          default: "pending",
        },
        method: { type: String, default: "standard" },
        type: {
          type: String,
          enum: ["manual", "automatic"],
          default: "manual",
        },
        source: {
          type: String,
          enum: ["wallet", "job_credit"],
          default: "wallet",
        },
        orderId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Order",
          default: null,
        }, // Track which order this payout/credit came from
        arrivalDate: { type: Date, default: null },
        createdAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true },
);

userSchema.index({
  location: "2dsphere",
});

const User = mongoose.model("User", userSchema);
export default User;
