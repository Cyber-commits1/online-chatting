import mongoose from "mongoose";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

// 🔹 JSON ni o‘qish
const data = JSON.parse(fs.readFileSync("./users.json", "utf-8"));
const users = data.users; // 👈 MUHIM JOY

// 🔹 User schema
const userSchema = new mongoose.Schema({
  id: String,
  username: String,
  email: String,
  password: String,
  avatar: String,
  status: String,
  createdAt: Date,
  lastSeen: Date,
  profile: Object
});

// 🔹 Model
const User = mongoose.model("User", userSchema);

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("MongoDB ulandi ✅");

  for (let u of users) {
    // duplicate bo‘lmasligi uchun tekshiruv
    const exists = await User.findOne({ email: u.email });
    if (!exists) {
      await User.create(u);
    }
  }

  console.log("Barcha userlar MongoDB ga yuklandi ✅");
  process.exit();
}

run();
