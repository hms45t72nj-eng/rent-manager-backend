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
const OWNER = process.env.OWNER_LINE_USER_ID;
let DB = [{"id":"prop-1","name":"4A","address":"","rent":4800,"tenant":{"name":"黃柏翰","phone":"","lineUserId":null,"moveIn":"","leaseEnd":"2027-02-28"},"payments":[]}];
let CFG = {rentReminderDay:1,rentDueDay:5,leaseWarningDays:60,rentTemplate:"您好，{租客姓名}，本月租金 ${金額} 尚未入帳，請於{提醒日}前完成匯款，謝謝。",leaseTemplate:"您好，{租客姓名}，您在 {房源} 的租約將於 {到期日} 到期（剩 {天數} 天），請確認是否續約，謝謝。"};
function getMonth(){const n=new Date();return n.getFullYear()+"-"+String(n.getMonth()+1).padStart(2,"0");}
function days(d){const t=new Date();t.setHours(0,0,0,0);return Math.ceil((new Date(d)-t)/86400000);}
async function push(uid,text){if(!uid)return;try{await lineClient.pushMessage({to:uid,messages:[{type:"text",text}]});}catch(e){console.log(e.message);}}
cron.schedule("0 9 * * *",async()=>{const m=getMonth();const d2=new Date().getDate();if(d2===CFG.rentReminderDay){const u=DB.filter(p=>p.tenant&&(!p.payments.find(x=>x.month===m)||!p.payments.find(x=>x.month===m).paid));for(const p of u)await push(p.tenant.lineUserId,CFG.rentTemplate.replace("{租客姓名}",p.tenant.name).replace("${金額}",p.rent.toLocaleString()).replace("{提醒日}",m+"-"+String(CFG.rentDueDay).padStart(2,"0")));if(u.length)await push(OWNER,"📋 未繳租提醒已發送\n"+u.map(p=>"・"+p.tenant.name+"（"+p.name+"）").join("\n"));}const ex=DB.filter(p=>p.tenant&&[CFG.leaseWarningDays,30,7].includes(days(p.tenant.leaseEnd)));for(const p of ex)await push(p.tenant.lineUserId,CFG.leaseTemplate.replace("{租客姓名}",p.tenant.name).replace("{房源}",p.name).replace("{到期日}",p.tenant.leaseEnd).replace("{天數}",days(p.tenant.leaseEnd)));if(ex.length)await push(OWNER,"🏠 合約到期提醒\n"+ex.map(p=>"・"+p.tenant.name+" 剩"+days(p.tenant.leaseEnd)+"天").join("\n"));});
app.get("/",(req,res)=>res.json({status:"ok"}));
app.get("/api/properties",(req,res)=>res.json(DB));
app.post("/api/properties",(req,res)=>{const p={id:uuidv4(),name:req.body.name,address:req.body.address||"",rent:parseInt(req.body.rent),tenant:null,payments:[]};DB.push(p);res.json(p);});
app.put("/api/properties/:id",(req,res)=>{const i=DB.findIndex(p=>p.id===req.params.id);if(i<0)return res.status(404).json({error:"找不到"});DB[i]={...DB[i],...req.body};res.json(DB[i]);});
app.delete("/api/properties/:id",(req,res)=>{DB=DB.filter(p=>p.id!==req.params.id);res.json({success:true});});
app.post("/api/properties/:id/pay",(req,res)=>{const p=DB.find(p=>p.id===req.params.id);if(!p)return res.status(404).json({error:"找不到"});const m=req.body.month;const e=p.payments.find(x=>x.month===m);if(e){e.paid=true;e.date=new Date().toISOString().slice(0,10);}else p.payments.push({month:m,paid:true,date:new Date().toISOString().slice(0,10)});res.json(p);});
app.post("/api/notify/rent",async(req,res)=>{const m=getMonth();const u=DB.filter(p=>p.tenant&&(!p.payments.find(x=>x.month===m)||!p.payments.find(x=>x.month===m).paid));for(const p of u)await push(p.tenant.lineUserId,CFG.rentTemplate.replace("{租客姓名}",p.tenant.name).replace("${金額}",p.rent.toLocaleString()).replace("{提醒日}",m+"-"+String(CFG.rentDueDay).padStart(2,"0")));if(u.length)await push(OWNER,"📋 收租提醒已發送，共"+u.length+"間");res.json({sent:u.length});});
app.post("/api/notify/lease",async(req,res)=>{const ex=DB.filter(p=>p.tenant&&days(p.tenant.leaseEnd)>=0&&days(p.tenant.leaseEnd)<=CFG.leaseWarningDays);for(const p of ex)await push(p.tenant.lineUserId,CFG.leaseTemplate.replace("{租客姓名}",p.tenant.name).replace("{房源}",p.name).replace("{到期日}",p.tenant.leaseEnd).replace("{天數}",days(p.tenant.leaseEnd)));if(ex.length)await push(OWNER,"🏠 續約提醒已發送，共"+ex.length+"間");res.json({sent:ex.length});});
app.get("/api/settings",(req,res)=>res.json(CFG));
app.put("/api/settings",(req,res)=>{CFG={...CFG,...req.body};res.json(CFG);});
app.post("/api/line/webhook",async(req,res)=>{res.json({ok:true});for(const e of req.body.events||[]){if(e.type==="follow"){await lineClient.replyMessage({replyToken:e.replyToken,messages:[{type:"text",text:"✅ 綁定成功！\n\nYour LINE ID："+e.source.userId+"\n\n請將此ID提供給房東完成綁定。"}]});}}});
const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log("✅ 後端啟動 Port:"+PORT));
