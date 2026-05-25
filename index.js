require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cron = require("node-cron");
const line = require("@line/bot-sdk");
const { v4: uuidv4 } = require("uuid");

const app = express();
app.use(cors());
app.use(express.json());

const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};
const lineClient = new line.messagingApi.MessagingApiClient(lineConfig);
const OWNER_LINE_USER_ID = process.env.OWNER_LINE_USER_ID;

let properties = [let properties = [
  {
    id: "prop-1",
    name: "4A",
    address: "",
    rent: 4800,
    tenant: {
      name: "黃柏翰",
      phone: "",
      lineUserId: null,
      moveIn: "",
      leaseEnd: "2027-02-28",
    },
    payments: [],
  },
];
];
let settings = {
  rentReminderDay: 1,
  rentDueDay: 5,
  leaseWarningDays: 60,
  rentTemplate: "您好，{租客姓名}，本月租金 ${金額} 尚未入帳，請於{提醒日}前完成匯款，謝謝。",
  leaseTemplate: "您好，{租客姓名}，您在 {房源} 的租約將於 {到期日} 到期（剩 {天數} 天），請確認是否續約，謝謝。",
};

function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function daysUntil(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  return Math.ceil((target - today) / (1000 * 60 * 60 * 24));
}

function buildRentMessage(prop) {
  const month = getCurrentMonth();
  return settings.rentTemplate
    .replace("{租客姓名}", prop.tenant.name)
    .replace("${金額}", prop.rent.toLocaleString())
    .replace("{提醒日}", `${month}-${String(settings.rentDueDay).padStart(2, "0")}`);
}

function buildLeaseMessage(prop) {
  const days = daysUntil(prop.tenant.leaseEnd);
  return settings.leaseTemplate
    .replace("{租客姓名}", prop.tenant.name)
    .replace("{房源}", prop.name)
    .replace("{到期日}", prop.tenant.leaseEnd)
    .replace("{天數}", days);
}

async function sendLineMessage(userId, text) {
  if (!userId) return { success: false, reason: "未綁定LINE" };
  try {
    await lineClient.pushMessage({ to: userId, messages: [{ type: "text", text }] });
    return { success: true };
  } catch (err) {
    return { success: false, reason: err.message };
  }
}

async function sendOwnerNotify(text) {
  if (!OWNER_LINE_USER_ID) return;
  await sendLineMessage(OWNER_LINE_USER_ID, text);
}

cron.schedule("0 9 * * *", async () => {
  const today = new Date();
  const dayOfMonth = today.getDate();
  const month = getCurrentMonth();

  if (dayOfMonth === settings.rentReminderDay) {
    const unpaid = properties.filter((p) => {
      if (!p.tenant) return false;
      const pay = p.payments.find((x) => x.month === month);
      return !pay || !pay.paid;
    });
    for (const prop of unpaid) {
      if (prop.tenant.lineUserId) await sendLineMessage(prop.tenant.lineUserId, buildRentMessage(prop));
    }
    if (unpaid.length > 0) {
      const summary = `📋 本月未繳租提醒已發送\n\n${unpaid.map((p) => `・${p.tenant.name}（${p.name}）`).join("\n")}\n\n共 ${unpaid.length} 間`;
      await sendOwnerNotify(summary);
    }
  }

  const expiring = properties.filter((p) => {
    if (!p.tenant) return false;
    const days = daysUntil(p.tenant.leaseEnd);
    return days === settings.leaseWarningDays || days === 30 || days === 7;
  });
  for (const prop of expiring) {
    if (prop.tenant.lineUserId) await sendLineMessage(prop.tenant.lineUserId, buildLeaseMessage(prop));
  }
  if (expiring.length > 0) {
    const summary = `🏠 合約即將到期\n\n${expiring.map((p) => `・${p.tenant.name} 剩${daysUntil(p.tenant.leaseEnd)}天`).join("\n")}`;
    await sendOwnerNotify(summary);
  }
});

app.get("/", (req, res) => res.json({ status: "ok" }));
app.get("/api/properties", (req, res) => res.json(properties));
app.post("/api/properties", (req, res) => {
  const { name, address, rent } = req.body;
  if (!name || !rent) return res.status(400).json({ error: "缺少欄位" });
  const prop = { id: uuidv4(), name, address, rent: parseInt(rent), tenant: null, payments: [] };
  properties.push(prop);
  res.json(prop);
});
app.put("/api/properties/:id", (req, res) => {
  const idx = properties.findIndex((p) => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "找不到" });
  properties[idx] = { ...properties[idx], ...req.body };
  res.json(properties[idx]);
});
app.delete("/api/properties/:id", (req, res) => {
  properties = properties.filter((p) => p.id !== req.params.id);
  res.json({ success: true });
});
app.post("/api/properties/:id/pay", (req, res) => {
  const { month } = req.body;
  const prop = properties.find((p) => p.id === req.params.id);
  if (!prop) return res.status(404).json({ error: "找不到" });
  const existing = prop.payments.find((p) => p.month === month);
  if (existing) { existing.paid = true; existing.date = new Date().toISOString().slice(0, 10); }
  else prop.payments.push({ month, paid: true, date: new Date().toISOString().slice(0, 10) });
  res.json(prop);
});
app.post("/api/notify/rent", async (req, res) => {
  const month = getCurrentMonth();
  const unpaid = properties.filter((p) => { if (!p.tenant) return false; const pay = p.payments.find((x) => x.month === month); return !pay || !pay.paid; });
  const results = [];
  for (const prop of unpaid) { const r = await sendLineMessage(prop.tenant.lineUserId, buildRentMessage(prop)); results.push({ tenant: prop.tenant.name, ...r }); }
  if (unpaid.length > 0) await sendOwnerNotify(`📋 收租提醒已發送，共 ${unpaid.length} 間`);
  res.json({ sent: results.length, results });
});
app.post("/api/notify/lease", async (req, res) => {
  const expiring = properties.filter((p) => { if (!p.tenant) return false; const days = daysUntil(p.tenant.leaseEnd); return days >= 0 && days <= settings.leaseWarningDays; });
  const results = [];
  for (const prop of expiring) { const r = await sendLineMessage(prop.tenant.lineUserId, buildLeaseMessage(prop)); results.push({ tenant: prop.tenant.name, ...r }); }
  if (expiring.length > 0) await sendOwnerNotify(`🏠 續約提醒已發送，共 ${expiring.length} 間`);
  res.json({ sent: results.length, results });
});
app.get("/api/settings", (req, res) => res.json(settings));
app.put("/api/settings", (req, res) => { settings = { ...settings, ...req.body }; res.json(settings); });

app.post("/api/line/webhook", async (req, res) => {
  res.json({ ok: true });
  const events = req.body.events || [];
  for (const event of events) {
    if (event.type === "follow") {
      const userId = event.source.userId;
      await lineClient.replyMessage({ replyToken: event.replyToken, messages: [{ type: "text", text: `✅ 綁定成功！\n\nYour LINE ID：${userId}\n\n請將此ID提供給房東完成綁定。` }] });
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ 後端啟動 Port:${PORT}`));
