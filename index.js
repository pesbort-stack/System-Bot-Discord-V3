const {
  Client,
  GatewayIntentBits,
  Partials,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  AttachmentBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  SectionBuilder,
  ThumbnailBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  AuditLogEvent,
  REST,
  Routes,
  SlashCommandBuilder,
  ChannelType,
} = require("discord.js");

const fs = require("fs");
const path = require("path");
const { createCanvas, loadImage } = require("@napi-rs/canvas");
const https = require("https");
const config = require("./config.js");

// Embed → Components v2 shim
class EmbedV2Builder {
  constructor() {
        this._color = null;
        this._title = null;
        this._description = null;
        this._fields = [];
        this._thumbnail = null;
        this._image = null;
        this._footer = null;
        this._author = null;
        this._timestamp = null;
  }
  setColor(c) { this._color = c; return this; }
  setTitle(t) { this._title = t; return this; }
  setDescription(d) { this._description = d; return this; }
  addFields(...fields) { this._fields.push(...fields.flat()); return this; }
  setThumbnail(url) { this._thumbnail = url || null; return this; }
  setImage(url) { this._image = url || null; return this; }
  setFooter(f) { this._footer = f; return this; }
  setAuthor(a) { this._author = a; return this; }
  setTimestamp(t = new Date()) { this._timestamp = t; return this; }

  toContainer() {
        const container = new ContainerBuilder();
        if (this._color !== null && this._color !== undefined) {
              container.setAccentColor(this._color);
        }

        let headerText = "";
        if (this._author?.name) headerText += `**${this._author.name}**\n`;
        if (this._title) headerText += `${this._title}\n`;
        if (this._description) headerText += this._description;
        headerText = headerText.trim();

        if (headerText && this._thumbnail) {
              container.addSectionComponents(
                    new SectionBuilder()
                          .addTextDisplayComponents(new TextDisplayBuilder().setContent(headerText))
                          .setThumbnailAccessory(new ThumbnailBuilder().setURL(this._thumbnail))
              );
        } else {
              if (headerText) {
                    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(headerText));
              }
              if (this._thumbnail) {
                    container.addSectionComponents(
                          new SectionBuilder()
                                .addTextDisplayComponents(new TextDisplayBuilder().setContent("\u200b"))
                                .setThumbnailAccessory(new ThumbnailBuilder().setURL(this._thumbnail))
                    );
              }
        }

        if (this._fields.length) {
              if (headerText || this._thumbnail) {
                    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
              }
              const fieldsText = this._fields
                    .map((f) => `**${f.name}**\n${f.value}`)
                    .join("\n\n");
              container.addTextDisplayComponents(new TextDisplayBuilder().setContent(fieldsText));
        }

        if (this._image) {
              container.addMediaGalleryComponents(
                    new MediaGalleryBuilder().addItems(
                          new MediaGalleryItemBuilder().setURL(this._image)
                    )
              );
        }

        if (this._footer?.text || this._timestamp) {
              container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
              let footerText = this._footer?.text || "";
              if (this._timestamp) {
                    const ts = this._timestamp instanceof Date ? this._timestamp : new Date(this._timestamp);
                    footerText += (footerText ? " • " : "") + `<t:${Math.floor(ts.getTime() / 1000)}:R>`;
              }
              container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${footerText}`));
        }

        return container;
  }
}

// يبني payload جاهز لإرسال Components v2: يمرَّر إمبيد واحد أو مصفوفة، مع أزرار/قوائم اختيارية
function v2Payload(embeds, extraComponents = []) {
  const list = Array.isArray(embeds) ? embeds : [embeds];
  const containers = list.filter(Boolean).map((e) => e.toContainer());
  return {
        components: [...containers, ...(extraComponents || [])],
        flags: MessageFlags.IsComponentsV2,
  };
}

// Message & Voice tracking
const DB_PATH = path.join(__dirname, "stats_db.json");

function loadDB() {
  try {
        if (fs.existsSync(DB_PATH)) {
              return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
        }
  } catch (e) {
        console.error("[DB] فشل تحميل stats_db.json:", e.message);
  }
  return { msg: {}, voice: {} };
}

function saveDB() {
  try {
        for (const [, s] of msgStats) {
              if (typeof s.totalCount !== "number") s.totalCount = 0;
        }
        for (const [, s] of voiceStats) {
              if (typeof s.totalMinutes !== "number") s.totalMinutes = 0;
        }

        const data = {
              msg: Object.fromEntries(msgStats),
              voice: Object.fromEntries(
                    [...voiceStats.entries()].map(([k, v]) => [k, { ...v, joinedAt: null }])
              ),
        };
        fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), "utf8");
  } catch (e) {
        console.error("[DB] فشل حفظ stats_db.json:", e.message);
  }
}

const _db = loadDB();
const msgStats = new Map(Object.entries(_db.msg || {}));
const voiceStats = new Map(Object.entries(_db.voice || {}));

setInterval(saveDB, 60_000);

function scheduleDailyReset() {
  const now = new Date();
  const nextMidnight = new Date(now);
  nextMidnight.setDate(nextMidnight.getDate() + 1);
  nextMidnight.setHours(0, 0, 0, 0);
  const delay = nextMidnight.getTime() - now.getTime();
  setTimeout(() => {
        console.log("[AUTO] تم تصفير احصائيات توب اليوم بالنجاح ✅");
        const todayStart = getTodayStart();
        for (const [, s] of msgStats) {
              if (typeof s.totalCount !== "number") s.totalCount = 0;
              s.totalCount += s.todayCount || 0;
              s.todayCount = 0;
              s.todayStart = todayStart;
        }
        for (const [, s] of voiceStats) {
              if (typeof s.totalMinutes !== "number") s.totalMinutes = 0;
              s.totalMinutes += s.dayMinutes || 0;
              s.dayMinutes = 0;
              s.dayStart = todayStart;
        }
        saveDB();
        scheduleDailyReset();
  }, delay);
}
scheduleDailyReset();

function scheduleWeeklyReset() {
  const now = new Date();
  const day = now.getDay();
  const daysUntilSunday = (7 - day) % 7 || 7;
  const nextSunday = new Date(now);
  nextSunday.setDate(now.getDate() + daysUntilSunday);
  nextSunday.setHours(0, 0, 0, 0);
  const delay = nextSunday.getTime() - now.getTime();
  setTimeout(() => {
        console.log("[AUTO] تصفير إحصائيات الأسبوع…");
        const weekStart = getWeekStart();
        for (const [, s] of msgStats) {
              if (typeof s.totalCount !== "number") s.totalCount = 0;
              s.totalCount += s.weekCount || 0;
              s.weekCount = 0;
              s.weekStart = weekStart;
        }
        for (const [, s] of voiceStats) {
              if (typeof s.totalMinutes !== "number") s.totalMinutes = 0;
              s.totalMinutes += s.weekMinutes || 0;
              s.weekMinutes = 0;
              s.weekStart = weekStart;
        }
        saveDB();
        scheduleWeeklyReset();
  }, delay);
}
scheduleWeeklyReset();

const MS_7DAYS = 7 * 24 * 60 * 60 * 1000;

function getWeekStart() {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day;
  const start = new Date(now.setDate(diff));
  start.setHours(0, 0, 0, 0);
  return start.getTime();
}

function getTodayStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function ensureMsgStats(userId, guildId) {
  const key = guildId ? `${guildId}:${userId}` : userId;
  if (!msgStats.has(key)) {
        msgStats.set(key, {
              todayCount: 0,
              todayStart: getTodayStart(),
              weekCount: 0,
              weekStart: getWeekStart(),
        });
  }
  const s = msgStats.get(key);
  const now = Date.now();
  if (now - s.todayStart >= 86400000) {
        s.todayCount = 0;
        s.todayStart = getTodayStart();
  }
  if (now - s.weekStart >= MS_7DAYS) {
        s.weekCount = 0;
        s.weekStart = getWeekStart();
  }
  return s;
}

function ensureVoiceStats(userId, guildId) {
  const key = guildId ? `${guildId}:${userId}` : userId;
  if (!voiceStats.has(key)) {
        voiceStats.set(key, {
              dayMinutes: 0,
              dayStart: getTodayStart(),
              weekMinutes: 0,
              weekStart: getWeekStart(),
              joinedAt: null,
        });
  }
  const s = voiceStats.get(key);
  const now = Date.now();
  if (now - s.dayStart >= 86400000) {
        s.dayMinutes = 0;
        s.dayStart = getTodayStart();
  }
  if (now - s.weekStart >= MS_7DAYS) {
        s.weekMinutes = 0;
        s.weekStart = getWeekStart();
  }
  return s;
}

function formatVoiceTime(minutes) {
  if (minutes < 1) return "0m";
  if (minutes < 60) return `${Math.floor(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.floor(minutes % 60);
  return m > 0 ? `${h}h:${String(m).padStart(2, "0")}` : `${h}h`;
}

async function fetchImageBuffer(url) {
  return new Promise((resolve, reject) => {
        https
              .get(url, (res) => {
                    const chunks = [];
                    res.on("data", (c) => chunks.push(c));
                    res.on("end", () => resolve(Buffer.concat(chunks)));
                    res.on("error", reject);
              })
              .on("error", reject)
              .setTimeout(5000, () => reject(new Error("Timeout")));
  });
}

//  عارض الصورة الرمزية / البانر — Components v2
const AVATAR_VIEW_COLOR = 0xED4245;

async function buildAvatarView(targetUser, targetMember, requester, mode = "avatar") {
  const freshUser = await client.users
        .fetch(targetUser.id, { force: true })
        .catch(() => targetUser);

  const globalAvatarURL =
        freshUser.displayAvatarURL({ size: 1024, extension: "png", forceStatic: false }) ||
        freshUser.defaultAvatarURL;

  const serverAvatarURL = targetMember?.avatar
        ? targetMember.displayAvatarURL({ size: 1024, extension: "png", forceStatic: false })
        : null;

  const bannerURL = freshUser.banner
        ? freshUser.bannerURL({ size: 1024, extension: "png", forceStatic: false })
        : null;

  const embed = new EmbedV2Builder().setColor(AVATAR_VIEW_COLOR);

  if (mode === "banner") {
        embed
              .setAuthor({
                    name: `بانر ${freshUser.username}`,
                    iconURL: freshUser.displayAvatarURL({ extension: "png", size: 64 }),
              })
              .setDescription(
                    bannerURL
                          ? `**البانر**\n[اضغط هنا لفتح الصورة الأصلية](${bannerURL})`
                          : "**لا يوجد بانر مضاف لهذا الحساب**"
              );
        if (bannerURL) embed.setImage(bannerURL);
  } else {
        embed
              .setAuthor({
                    name: `صورة ${freshUser.username}`,
                    iconURL: freshUser.displayAvatarURL({ extension: "png", size: 64 }),
              })
              .addFields(
                    {
                          name: `صورة السيرفر`,
                          value: serverAvatarURL ? `[اضغط هنا](${serverAvatarURL})` : "غير محددة",
                          inline: true,
                    },
                    {
                          name: `الصورة العامة`,
                          value: `[اضغط هنا](${globalAvatarURL})`,
                          inline: true,
                    }
              )
              .setImage(serverAvatarURL || globalAvatarURL);
  }

  embed
        .setFooter({
              text: `تم الطلب من قبل ${requester.username}`,
              iconURL: requester.displayAvatarURL({ extension: "png", size: 64 }),
        })
        .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
              .setCustomId(`avatarview_avatar_${targetUser.id}_${requester.id}`)
              .setLabel("Avatar")
              .setStyle(mode === "avatar" ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder()
              .setCustomId(`avatarview_banner_${targetUser.id}_${requester.id}`)
              .setLabel("Banner")
              .setStyle(mode === "banner" ? ButtonStyle.Primary : ButtonStyle.Secondary)
              .setDisabled(!bannerURL)
  );

  return v2Payload(embed, [row]);
}

const prisonCfg = new Map();

async function generateIdCard(member, msgData, voiceData) {
  const W = 900,
        H = 420;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  try {
        const bgImg = await loadImage(path.join(__dirname, "bg.png"));
        ctx.drawImage(bgImg, 0, 0, W, H);
  } catch {
        const bgGrad = ctx.createLinearGradient(0, 0, W, H);
        bgGrad.addColorStop(0, "#0a0505");
        bgGrad.addColorStop(0.5, "#1a0808");
        bgGrad.addColorStop(1, "#0a0505");
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, W, H);
  }

  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  const cardGrad = ctx.createLinearGradient(0, 0, W, H);
  cardGrad.addColorStop(0, "rgba(255,255,255,0.15)");
  cardGrad.addColorStop(0.5, "rgba(255,255,255,0.05)");
  cardGrad.addColorStop(1, "rgba(255,255,255,0.12)");
  ctx.strokeStyle = cardGrad;
  ctx.lineWidth = 2;
  roundRect(ctx, 10, 10, W - 20, H - 20, 20);
  ctx.stroke();

  ctx.fillStyle = "rgba(255,255,255,0.02)";
  roundRect(ctx, 10, 10, W - 20, H - 20, 20);
  ctx.fill();
  ctx.restore();

  // ── Avatar in Circle (Left Side) ──
  try {
        const avatarUrl = member.displayAvatarURL({ extension: "png", size: 256 });
        const avatarBuf = await fetchImageBuffer(avatarUrl);
        const avatarImg = await loadImage(avatarBuf);

        const circleCenterX = 120;
        const circleCenterY = 140;
        const circleRadius = 85;

        // Draw circle with border
        ctx.save();
        ctx.beginPath();
        ctx.arc(circleCenterX, circleCenterY, circleRadius, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(avatarImg, circleCenterX - circleRadius, circleCenterY - circleRadius, circleRadius * 2, circleRadius * 2);
        ctx.restore();

        // Circle border
        const borderGrad = ctx.createLinearGradient(circleCenterX - circleRadius, circleCenterY - circleRadius, circleCenterX + circleRadius, circleCenterY + circleRadius);
        borderGrad.addColorStop(0, "rgba(100, 200, 255, 0.6)");
        borderGrad.addColorStop(0.5, "rgba(100, 150, 255, 0.4)");
        borderGrad.addColorStop(1, "rgba(100, 200, 255, 0.6)");
        ctx.strokeStyle = borderGrad;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(circleCenterX, circleCenterY, circleRadius, 0, Math.PI * 2);
        ctx.stroke();
  } catch (e) {
        ctx.fillStyle = "rgba(100, 100, 150, 0.5)";
        ctx.beginPath();
        ctx.arc(120, 140, 85, 0, Math.PI * 2);
        ctx.fill();
  }

  // ── Username at Top (Center) ──
  ctx.save();
  const userGrad = ctx.createLinearGradient(300, 40, 700, 90);
  userGrad.addColorStop(0, "#ffffff");
  userGrad.addColorStop(0.5, "#e0e0ff");
  userGrad.addColorStop(1, "#ffffff");
  ctx.fillStyle = userGrad;
  ctx.font = "bold 50px Arial";
  ctx.textBaseline = "top";
  ctx.textAlign = "center";
  const displayName = member.displayName || member.user.username;
  ctx.fillText(displayName, W / 2, 50);
  ctx.restore();

  // ── Separator Line ──
  ctx.save();
  const lineGrad = ctx.createLinearGradient(40, 260, W - 40, 260);
  lineGrad.addColorStop(0, "rgba(255,255,255,0)");
  lineGrad.addColorStop(0.1, "rgba(255,255,255,0.2)");
  lineGrad.addColorStop(0.9, "rgba(255,255,255,0.2)");
  lineGrad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.strokeStyle = lineGrad;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(40, 264);
  ctx.lineTo(W - 40, 264);
  ctx.stroke();
  ctx.restore();

  // ── Message and Voice Stats (Exact Layout from Reference Image) ──
  // TEXT Section (Left Box)
  ctx.save();
  ctx.fillStyle = "rgba(100, 150, 255, 0.2)";
  ctx.strokeStyle = "rgba(100, 150, 255, 0.4)";
  ctx.lineWidth = 1.5;
  roundRect(ctx, 60, 290, 200, 95, 10);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // TEXT Label
  ctx.save();
  ctx.fillStyle = "#a0a0ff";
  ctx.font = "bold 14px Arial";
  ctx.textBaseline = "top";
  ctx.fillText("📄 TEXT", 80, 305);
  ctx.restore();

  // TEXT Today Count
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 32px Arial";
  ctx.textBaseline = "top";
  ctx.fillText(String(msgData.todayCount), 80, 330);
  ctx.restore();

  // TEXT This Week Count
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 32px Arial";
  ctx.textBaseline = "top";
  ctx.fillText(String(msgData.weekCount), 180, 330);
  ctx.restore();

  // VOICE Section (Right Box)
  ctx.save();
  ctx.fillStyle = "rgba(255, 100, 100, 0.2)";
  ctx.strokeStyle = "rgba(255, 100, 100, 0.4)";
  ctx.lineWidth = 1.5;
  roundRect(ctx, 530, 290, 200, 95, 10);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // VOICE Label
  ctx.save();
  ctx.fillStyle = "#ff9090";
  ctx.font = "bold 14px Arial";
  ctx.textBaseline = "top";
  ctx.fillText("🎤 VOICE", 550, 305);
  ctx.restore();

  // VOICE Today Time
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 32px Arial";
  ctx.textBaseline = "top";
  ctx.fillText(formatVoiceTime(voiceData.dayMinutes), 550, 330);
  ctx.restore();

  // VOICE This Week Time
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 32px Arial";
  ctx.textBaseline = "top";
  ctx.fillText(formatVoiceTime(voiceData.weekMinutes), 650, 330);
  ctx.restore();

  return canvas.toBuffer("image/png");
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

const client = new Client({
  intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildInvites,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

const OWNER_ID = "700851820272156703";
const NO_PERM_MSG = "**عذرا ليس لديك الصلاحية**❌";

// Slash command permission helpers
function requirePermSlash(interaction, flag) {
  if (interaction.member.permissions.has(flag)) return true;
  interaction.reply({ content: NO_PERM_MSG, flags: MessageFlags.Ephemeral }).catch(() => {});
  return false;
}
function requireOwnerOrAdminSlash(interaction) {
  if (interaction.user.id === OWNER_ID || interaction.member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  interaction.reply({ content: NO_PERM_MSG, flags: MessageFlags.Ephemeral }).catch(() => {});
  return false;
}
function requireOwnerSlash(interaction) {
  if (interaction.user.id === OWNER_ID) return true;
  interaction.reply({ content: NO_PERM_MSG, flags: MessageFlags.Ephemeral }).catch(() => {});
  return false;
}

// جلب GuildMember بشكل موثوق من أوبشن يوزر بالسلاش كوماند (يحل مشكلة getMember() اللي ترجع null)
async function getTargetMember(interaction, optionName = "member") {
  const cached = interaction.options.getMember(optionName);
  if (cached) return cached;
  const user = interaction.options.getUser(optionName);
  if (!user) return null;
  return interaction.guild.members.fetch(user.id).catch(() => null);
}

const greetCfg = new Map();

const LOG_SETTINGS_PATH = path.join(__dirname, "log_settings.json");

function loadLogSettings() {
  try {
        if (fs.existsSync(LOG_SETTINGS_PATH))
              return new Map(
                    Object.entries(JSON.parse(fs.readFileSync(LOG_SETTINGS_PATH, "utf8")))
              );
  } catch (e) {
        console.error("[LOG] فشل تحميل log_settings.json:", e.message);
  }
  return new Map();
}

function saveLogSettings() {
  try {
        fs.writeFileSync(
              LOG_SETTINGS_PATH,
              JSON.stringify(Object.fromEntries(logSettings), null, 2),
              "utf8"
        );
  } catch (e) {
        console.error("[LOG] فشل حفظ log_settings.json:", e.message);
  }
}

const logSettings = loadLogSettings();

// ── تخزين الردود التلقائية ──
const AUTORESPONDER_PATH = path.join(__dirname, "autoresponders.json");

function loadAutoresponders() {
  try {
        if (fs.existsSync(AUTORESPONDER_PATH))
              return new Map(
                    Object.entries(JSON.parse(fs.readFileSync(AUTORESPONDER_PATH, "utf8")))
              );
  } catch (e) {
        console.error("[AR] فشل تحميل autoresponders.json:", e.message);
  }
  return new Map();
}

function saveAutoresponders() {
  try {
        fs.writeFileSync(
              AUTORESPONDER_PATH,
              JSON.stringify(Object.fromEntries(autoresponders), null, 2),
              "utf8"
        );
  } catch (e) {
        console.error("[AR] فشل حفظ autoresponders.json:", e.message);
  }
}

const autoresponders = loadAutoresponders();

// ── الاختصارات وصورة الخط ──
const ALIASES_PATH = path.join(__dirname, "aliases.json");
const LINE_PATH = path.join(__dirname, "line_settings.json");

function loadJsonMap(filePath, label) {
  try {
    if (fs.existsSync(filePath)) {
      return new Map(Object.entries(JSON.parse(fs.readFileSync(filePath, "utf8"))));
    }
  } catch (e) {
    console.error(`[${label}] فشل التحميل:`, e.message);
  }
  return new Map();
}

function saveJsonMap(map, filePath, label) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(Object.fromEntries(map), null, 2), "utf8");
  } catch (e) {
    console.error(`[${label}] فشل الحفظ:`, e.message);
  }
}

const aliasesDB = loadJsonMap(ALIASES_PATH, "ALIASES");
const lineDB = loadJsonMap(LINE_PATH, "LINE");

function saveAliases() {
  saveJsonMap(aliasesDB, ALIASES_PATH, "ALIASES");
}

function saveLines() {
  saveJsonMap(lineDB, LINE_PATH, "LINE");
}

// ── تخزين رتب الألوان ──
const COLOR_ROLES_PATH = path.join(__dirname, "color_roles.json");

function loadColorRoles() {
  try {
        if (fs.existsSync(COLOR_ROLES_PATH))
              return new Map(
                    Object.entries(JSON.parse(fs.readFileSync(COLOR_ROLES_PATH, "utf8")))
              );
  } catch (e) {
        console.error("[COLORS] فشل تحميل color_roles.json:", e.message);
  }
  return new Map();
}

function saveColorRoles() {
  try {
        fs.writeFileSync(
              COLOR_ROLES_PATH,
              JSON.stringify(Object.fromEntries(colorRoles), null, 2),
              "utf8"
        );
  } catch (e) {
        console.error("[COLORS] فشل حفظ color_roles.json:", e.message);
  }
}

const colorRoles = loadColorRoles();

//  ── تخزين التحذيرات (Warnings) ──
const WARNINGS_PATH = path.join(__dirname, "warnings.json");

function loadWarnings() {
  try {
        if (fs.existsSync(WARNINGS_PATH))
              return new Map(
                    Object.entries(JSON.parse(fs.readFileSync(WARNINGS_PATH, "utf8")))
              );
  } catch (e) {
        console.error("[WARNS] فشل تحميل warnings.json:", e.message);
  }
  return new Map();
}

function saveWarnings() {
  try {
        fs.writeFileSync(
              WARNINGS_PATH,
              JSON.stringify(Object.fromEntries(warningsDB), null, 2),
              "utf8"
        );
  } catch (e) {
        console.error("[WARNS] فشل حفظ warnings.json:", e.message);
  }
}

const warningsDB = loadWarnings();

//  ── تخزين القائمة السوداء (Blacklist) ──
const BLACKLIST_PATH = path.join(__dirname, "blacklist.json");

function loadBlacklist() {
  try {
        if (fs.existsSync(BLACKLIST_PATH))
              return new Map(
                    Object.entries(JSON.parse(fs.readFileSync(BLACKLIST_PATH, "utf8"))).map(([gid, arr]) => [gid, new Set(arr)])
              );
  } catch (e) {
        console.error("[BLACKLIST] فشل تحميل blacklist.json:", e.message);
  }
  return new Map();
}

function saveBlacklist() {
  try {
        fs.writeFileSync(
              BLACKLIST_PATH,
              JSON.stringify(Object.fromEntries(Array.from(blacklistDB.entries()).map(([gid, set]) => [gid, Array.from(set)])), null, 2),
              "utf8"
        );
  } catch (e) {
        console.error("[BLACKLIST] فشل حفظ blacklist.json:", e.message);
  }
}

const blacklistDB = loadBlacklist();

//  ── تخزين وضع الصيانة (Maintenance Mode) ──
const MAINTENANCE_PATH = path.join(__dirname, "maintenance.json");

function loadMaintenance() {
  try {
        if (fs.existsSync(MAINTENANCE_PATH))
              return new Map(
                    Object.entries(JSON.parse(fs.readFileSync(MAINTENANCE_PATH, "utf8")))
              );
  } catch (e) {
        console.error("[MAINTENANCE] فشل تحميل maintenance.json:", e.message);
  }
  return new Map();
}

function saveMaintenance() {
  try {
        fs.writeFileSync(
              MAINTENANCE_PATH,
              JSON.stringify(Object.fromEntries(maintenanceDB), null, 2),
              "utf8"
        );
  } catch (e) {
        console.error("[MAINTENANCE] فشل حفظ maintenance.json:", e.message);
  }
}

const maintenanceDB = loadMaintenance();

// ── AFK Map ──
const afkMap = new Map();

// ── Snipe Map ──
const snipeMap = new Map();

function getLogChannel(guild, type) {
  const cfg = logSettings.get(guild.id);
  if (!cfg || !cfg[type]) return null;
  return guild.channels.cache.get(cfg[type]) || null;
}

async function sendLog(guild, type, embed) {
  const ch = getLogChannel(guild, type);
  if (!ch) return;
  await ch.send(v2Payload(embed)).catch(() => {});
}

async function sendModLog(guild, { action, moderator, target, reason, extra }) {
  const ch = getLogChannel(guild, "moderation");
  if (!ch) return;

  const targetMention = target ? `<@${target.id}>` : "غير محدد";
  const moderatorMention = moderator ? `<@${moderator.id}>` : "غير محدد";
  const timeStamp = `<t:${Math.floor(Date.now() / 1000)}:F>`;
  const reasonText = reason || "لا يوجد سبب";

  let title, description;

  if (action === "طرد (Kick)") {
        title = `🚪 سجل الإجراء — طرد`;
        description = [
              `- تم الطرد : ${targetMention}`,
              `- سبب الطرد : ${reasonText}`,
              `- مسؤول : ${moderatorMention}`,
              `- توقيت الطرد : ${timeStamp}`,
        ].join("\n");
  } else if (action === "حظر (Ban)") {
        title = `🔨 سجل الإجراء — حظر`;
        description = [
              `- تم الحظر : ${targetMention}`,
              `- سبب الحظر : ${reasonText}`,
              `- مسؤول : ${moderatorMention}`,
              `- توقيت الحظر : ${timeStamp}`,
        ].join("\n");
  } else if (action === "سجن (Prison)") {
        title = `🔒 سجل الإجراء — سجن`;
        description = [
              `- تم السجن : ${targetMention}`,
              `- سبب السجن : ${reasonText}`,
              `- مسؤول : ${moderatorMention}`,
              `- توقيت السجن : ${timeStamp}`,
        ].join("\n");
  } else {
        title = `🛡️ سجل الاجرائات — ${action}`;
        description = [
              `- العضو : ${targetMention}`,
              `- السبب : ${reasonText}`,
              `- مسؤول : ${moderatorMention}`,
              `- الوقت : ${timeStamp}`,
              ...(extra ? [`- تفاصيل : ${extra}`] : []),
        ].join("\n");
  }

  const embed = new EmbedV2Builder()
        .setColor(0x8B0000)
        .setTitle(title)
        .setDescription(description)
        .setTimestamp();

  if (target?.displayAvatarURL) {
        embed.setThumbnail(target.displayAvatarURL({ extension: "png", size: 128 }));
  }

  await ch.send(v2Payload(embed)).catch(() => {});
}

//  تتبّع الدعوات — لمعرفة من طرف مين انضم العضو
const inviteCache = new Map(); // guildId -> Map(code -> uses)

async function cacheGuildInvites(guild) {
  const map = new Map();
  try {
        const invites = await guild.invites.fetch();
        invites.forEach((inv) => map.set(inv.code, inv.uses || 0));
  } catch (e) {}
  try {
        if (guild.vanityURLCode) {
              const vanity = await guild.fetchVanityData().catch(() => null);
              if (vanity) map.set(guild.vanityURLCode, vanity.uses || 0);
        }
  } catch (e) {}
  inviteCache.set(guild.id, map);
}

async function findUsedInvite(guild) {
  const before = inviteCache.get(guild.id) || new Map();
  const after = new Map();
  let inviter = null;
  let code = null;

  try {
        const invites = await guild.invites.fetch();
        invites.forEach((inv) => {
              after.set(inv.code, inv.uses || 0);
              if ((inv.uses || 0) > (before.get(inv.code) || 0)) {
                    inviter = inv.inviter;
                    code = inv.code;
              }
        });
  } catch (e) {}

  try {
        if (guild.vanityURLCode) {
              const vanity = await guild.fetchVanityData().catch(() => null);
              if (vanity) {
                    after.set(guild.vanityURLCode, vanity.uses || 0);
                    if ((vanity.uses || 0) > (before.get(guild.vanityURLCode) || 0)) {
                          code = guild.vanityURLCode;
                    }
              }
        }
  } catch (e) {}

  inviteCache.set(guild.id, after);
  return { inviter, code };
}

//  جلب المسؤول عن إجراء إداري عبر سجل التدقيق (Audit Log)
async function getAuditExecutor(guild, auditType, targetId) {
  try {
        const logs = await guild.fetchAuditLogs({ type: auditType, limit: 5 });
        const entry =
              logs.entries.find((e) => !targetId || e.targetId === targetId) ||
              logs.entries.first();
        if (!entry) return null;
        if (Date.now() - entry.createdTimestamp > 15000) return null;
        return entry.executor || null;
  } catch (e) {
        return null;
  }
}

const REALM = "<a:diamond:822106729210052679>";

function parseDuration(str) {
  const map = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  const unit = str.slice(-1).toLowerCase();
  const val = parseInt(str);
  return (map[unit] ?? 1000) * val;
}

function formatUptime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  let result = "";
  if (days) result += `${days} يوم `;
  if (hours) result += `${hours} ساعة `;
  if (mins) result += `${mins} دقيقة `;
  result += `${secs} ثانية`;
  return result.trim();
}


// ── تعريفات السلاش كوماند ──
const slashCommands = [
  new SlashCommandBuilder().setName("help").setDescription("Show all available commands | عرض قائمة جميع الاوامر"),
  new SlashCommandBuilder().setName("top").setDescription("Show server leaderboard | عرض لوحة الصدارة")
        .addStringOption(o => o.setName("period").setDescription("الفترة").addChoices(
              { name: "All Time", value: "alltime" },
              { name: "Today", value: "day" },
              { name: "This Week", value: "week" }
        )),
  new SlashCommandBuilder().setName("user").setDescription("Show full member information | عرض معلومات كاملة عن العضو")
        .addUserOption(o => o.setName("member").setDescription("العضو")),
  new SlashCommandBuilder().setName("serverinfo").setDescription("Show Server information | عرض معلومات السيرفر"),
  new SlashCommandBuilder().setName("avatar").setDescription("Get user avatar and banner| عرض الصورة والبانر عضو")
        .addUserOption(o => o.setName("member").setDescription("العضو")),
  new SlashCommandBuilder().setName("roles").setDescription("Show all server roles list | عرض قائمة جميع الرتب ")
        .addIntegerOption(o => o.setName("page").setDescription("رقم الصفحة").setMinValue(1)),
  new SlashCommandBuilder().setName("invites").setDescription("Show member invites info | عرض معلومات دعوات العضو")
        .addUserOption(o => o.setName("member").setDescription("العضو")),
  new SlashCommandBuilder().setName("afk").setDescription("Set your status to AFK | ضع حالتك كغئاب")
        .addStringOption(o => o.setName("reason").setDescription("السبب")),
  new SlashCommandBuilder().setName("snipe").setDescription("Show last deleted message | عرض آخر رسالة"),
  new SlashCommandBuilder().setName("kick").setDescription("Kick member from server | طرد عضو من سيرفر")
        .addUserOption(o => o.setName("member").setDescription("العضو").setRequired(true))
        .addStringOption(o => o.setName("reason").setDescription("السبب")),
  new SlashCommandBuilder().setName("ban").setDescription("Ban member from server | حظر عضو من السيرفر")
        .addUserOption(o => o.setName("member").setDescription("العضو").setRequired(true))
        .addStringOption(o => o.setName("reason").setDescription("السبب")),
  new SlashCommandBuilder().setName("massban").setDescription("Ban multiple members at once | حظر عدة أعضاء دفعة واحدة")
        .addStringOption(o => o.setName("users").setDescription("قائمة الأيديات مفصولة بمسافة").setRequired(true))
        .addStringOption(o => o.setName("reason").setDescription("السبب")),
  new SlashCommandBuilder().setName("unban").setDescription("unban member from server | ازاله الحظر عن العضو")
        .addStringOption(o => o.setName("user").setDescription("أيدي أو username العضو").setRequired(true)),
  new SlashCommandBuilder().setName("warn").setDescription("Warn a member | تحذير عضو")
        .addUserOption(o => o.setName("member").setDescription("العضو").setRequired(true))
        .addStringOption(o => o.setName("reason").setDescription("السبب").setRequired(true)),
  new SlashCommandBuilder().setName("warnings").setDescription("Show member warnings | عرض تحذيرات العضو")
        .addUserOption(o => o.setName("member").setDescription("العضو")),
  new SlashCommandBuilder().setName("warns").setDescription("Show warned members list | عرض قائمة الأعضاء المحذرين"),
  new SlashCommandBuilder().setName("move").setDescription("Move member to voice channel | نقل عضو إلى")
        .addUserOption(o => o.setName("member").setDescription("العضو").setRequired(true))
        .addChannelOption(o => o.setName("channel").setDescription("القناة الصوتية").setRequired(true)
              .addChannelTypes(ChannelType.GuildVoice)),
  new SlashCommandBuilder().setName("clear").setDescription("Delete messages in channel | حزف الرسائل من الروم")
        .addIntegerOption(o => o.setName("amount").setDescription("العدد").setRequired(true).setMinValue(1).setMaxValue(500)),
  new SlashCommandBuilder().setName("lock").setDescription("Lock channel or all channels | قفل قناة أو جميع القنوات")
        .addBooleanOption(o => o.setName("all").setDescription("قفل جميع القنوات")),
  new SlashCommandBuilder().setName("unlock").setDescription("Unlock current channel | فتح القناة الحالية"),
  new SlashCommandBuilder().setName("hide").setDescription("Hide current channel | إخفاء القناة الحالية"),
  new SlashCommandBuilder().setName("unhide").setDescription("Unhide current channel | إظهار القناة الحالية"),
  new SlashCommandBuilder().setName("hideall").setDescription("Hide all channels | إخفاء جميع القنوات"),
  new SlashCommandBuilder().setName("embed").setDescription("Send a embed in room | ارسال امبيد في الروم")
        .addStringOption(o => o.setName("text").setDescription("النص").setRequired(true)),
  new SlashCommandBuilder().setName("role").setDescription("Add or remove role from member | إضافة أو إزالة رتبة من عضو")
        .addUserOption(o => o.setName("member").setDescription("العضو").setRequired(true))
        .addRoleOption(o => o.setName("role").setDescription("الرتبة").setRequired(true)),
  new SlashCommandBuilder().setName("nick").setDescription("Change member nickname | تغيير لقب عضو")
        .addUserOption(o => o.setName("member").setDescription("العضو").setRequired(true))
        .addStringOption(o => o.setName("name").setDescription("الاسم الجديد").setRequired(true)),
  new SlashCommandBuilder().setName("addemoji").setDescription("Add emoji to server | اضافة ايموجي في السيرفر")
        .addStringOption(o => o.setName("name").setDescription("اسم الايموجي").setRequired(true))
        .addStringOption(o => o.setName("image").setDescription("رابط صورة الايموجي").setRequired(true)),
  new SlashCommandBuilder().setName("addsticker").setDescription("Add sticker to server | اضافة ستيكر في السيرفر")
        .addStringOption(o => o.setName("name").setDescription("اسم الستيكر").setRequired(true))
        .addStringOption(o => o.setName("image").setDescription("رابط صورة الستيكر").setRequired(true))
        .addStringOption(o => o.setName("tags").setDescription("كلمة مرتبطة بالستيكر (emoji متعلق)").setRequired(true))
        .addStringOption(o => o.setName("description").setDescription("وصف الستيكر")),
  new SlashCommandBuilder().setName("createrole").setDescription("Create a role with permissions | انشاء رتبة مع تحديد صلاحيات")
        .addStringOption(o => o.setName("name").setDescription("اسم الرتبة").setRequired(true))
        .addStringOption(o => o.setName("color").setDescription("لون الرتبة HEX مثل #FF0000"))
        .addBooleanOption(o => o.setName("admin").setDescription("منح صلاحية Administrator كاملة"))
        .addBooleanOption(o => o.setName("hoist").setDescription("إظهار الرتبة بشكل منفصل بقائمة الأعضاء"))
        .addBooleanOption(o => o.setName("mentionable").setDescription("السماح بمنشن الرتبة")),
  new SlashCommandBuilder().setName("dm").setDescription("Send a direct message to a member | ارسال رسالة خاصة لعضو")
        .addUserOption(o => o.setName("member").setDescription("العضو").setRequired(true))
        .addStringOption(o => o.setName("message").setDescription("نص الرسالة").setRequired(true)),
  new SlashCommandBuilder().setName("mutevoice").setDescription("Mute or unmute member in voice | كتم أو الغاء كتم عضو صوتيا")
        .addUserOption(o => o.setName("member").setDescription("العضو").setRequired(true))
        .addBooleanOption(o => o.setName("state").setDescription("true للكتم | false لإلغاء الكتم")),
  new SlashCommandBuilder().setName("autoresponder").setDescription("Setting auto reply | اعداد الردود التلقائية")
        .addSubcommand(s => s.setName("add").setDescription("إضافة رد تلقائي")
              .addStringOption(o => o.setName("trigger").setDescription("الكلمة").setRequired(true))
              .addStringOption(o => o.setName("response").setDescription("الرد").setRequired(true)))
        .addSubcommand(s => s.setName("remove").setDescription("حذف رد تلقائي")
              .addStringOption(o => o.setName("trigger").setDescription("الكلمة").setRequired(true)))
        .addSubcommand(s => s.setName("list").setDescription("عرض قائمة الردود التلقائية")),
  new SlashCommandBuilder().setName("addalias").setDescription("Add a command alias | إضافة اختصار لأمر")
        .addStringOption(o => o.setName("alias").setDescription("الاختصار").setRequired(true))
        .addStringOption(o => o.setName("command").setDescription("اسم الأمر الموجود").setRequired(true)),
  new SlashCommandBuilder().setName("alias").setDescription("Show all command aliases | عرض جميع الاختصارات"),
  new SlashCommandBuilder().setName("autoreply").setDescription("Add a plain auto reply | إضافة رد تلقائي بدون إمبيد")
        .addStringOption(o => o.setName("trigger").setDescription("الكلمة").setRequired(true))
        .addStringOption(o => o.setName("response").setDescription("الرد").setRequired(true)),
  new SlashCommandBuilder().setName("replys").setDescription("Show all plain auto replies | عرض جميع الردود التلقائية"),
  new SlashCommandBuilder().setName("setline").setDescription("Set the line image | تحديد صورة الخط")
        .addStringOption(o => o.setName("image").setDescription("رابط صورة الخط").setRequired(true)),
  new SlashCommandBuilder().setName("line").setDescription("Send the line image | إرسال صورة الخط"),
  new SlashCommandBuilder().setName("prison").setDescription("Prison member and restrict access | سجن عضو وتقييد وصوله")
        .addUserOption(o => o.setName("member").setDescription("العضو").setRequired(true)),
  new SlashCommandBuilder().setName("unprison").setDescription("Release member from prison | الإفراج عن عضو")
        .addUserOption(o => o.setName("member").setDescription("العضو").setRequired(true)),
  new SlashCommandBuilder().setName("setprison").setDescription("Set prison channel | تحديد روم السجن")
        .addChannelOption(o => o.setName("channel").setDescription("الروم").setRequired(true)),
  new SlashCommandBuilder().setName("rar").setDescription("Remove all roles from member | ازاله جميع الرتب عن عضو")
        .addUserOption(o => o.setName("member").setDescription("العضو").setRequired(true)),
  new SlashCommandBuilder().setName("setavatar").setDescription("Change bot image | تغيير الصوره بوت")
        .addStringOption(o => o.setName("url").setDescription("رابط الصورة").setRequired(true)),
  new SlashCommandBuilder().setName("setbanner").setDescription("Change bot banner | تغيير بانر البوت")
        .addStringOption(o => o.setName("url").setDescription("رابط الصورة").setRequired(true)),
  new SlashCommandBuilder().setName("setbio").setDescription("Change bot description | تغيير الوصف بوت")
        .addStringOption(o => o.setName("text").setDescription("النص").setRequired(true)),
  new SlashCommandBuilder().setName("setname").setDescription("Change bot name | تغيير اسم البوت")
        .addStringOption(o => o.setName("name").setDescription("الاسم الجديد").setRequired(true)),
  new SlashCommandBuilder().setName("backupserver").setDescription("Take a full server backup | أخذ نسخة احتياطية كاملة للسيرفر"),
  new SlashCommandBuilder().setName("blacklist").setDescription("Manage command blacklist | إدارة القائمة السوداء للأوامر")
        .addSubcommand(s => s.setName("add").setDescription("منع عضو من استخدام الأوامر")
              .addUserOption(o => o.setName("member").setDescription("العضو").setRequired(true)))
        .addSubcommand(s => s.setName("remove").setDescription("السماح لعضو باستخدام الأوامر")
              .addUserOption(o => o.setName("member").setDescription("العضو").setRequired(true))),
  new SlashCommandBuilder().setName("maintenance").setDescription("Toggle maintenance mode | تفعيل أو إلغاء وضع الصيانة")
        .addBooleanOption(o => o.setName("state").setDescription("true للتفعيل | false للإلغاء").setRequired(true)),
  new SlashCommandBuilder().setName("setwelcome").setDescription("Select Welcome room | تحديد روم الترحيب")
        .addChannelOption(o => o.setName("channel").setDescription("القناة").setRequired(true)),
  new SlashCommandBuilder().setName("setleave").setDescription("Select leave room | تحدبد روم المغادرة")
        .addChannelOption(o => o.setName("channel").setDescription("القناة").setRequired(true)),
  new SlashCommandBuilder().setName("welcomemsg").setDescription("Set welcome message | تحديد رساله الترحيب")
        .addStringOption(o => o.setName("message").setDescription("الرسالة — {user} {server}").setRequired(true)),
  new SlashCommandBuilder().setName("leavemsg").setDescription("Set leave message | تحديد الرساله المغادرة")
        .addStringOption(o => o.setName("message").setDescription("الرسالة — {user} {server}").setRequired(true)),
  new SlashCommandBuilder().setName("testwelcome").setDescription("Test welcome | اختبار الرساله الترحيب"),
  new SlashCommandBuilder().setName("testleave").setDescription("test leave | اختبار الرساله المغادرة"),
  new SlashCommandBuilder().setName("resetgreet").setDescription("Reset all setting welcome | اعادة تعيين اعدادات الترحيب"),
].map(c => c.toJSON());

function buildHelpMainText(user) {
  return [
        `# 🐻 أهلاً، ${user.username} !`,
        `## أنا **WraithPremium ++**، بوت متطور صنعه <@673645931014651907>`,
        `### مخصص لخدمة **سيرفر Wraith** بأفضل المميزات.`,
        `**ℹ️ اختر فئة من القائمة أدناه لعرض الأوامر! 🌍**`,
  ].join("\n");
}

function buildHelpEmbed(category, user) {
  if (!category || category === "main") return null;

  switch (category) {
        case "Owner":
              return new EmbedV2Builder()
                    .setTitle(`# 👑 Owner Commands`)
                    .setDescription(
                          [
                                `<:bloodt:1533965277581017178> \`/setavatar\``,
                                `> <a:emoji_106:1536025128926978078> Change bot image | للتغير الصوره بوت`,
                                `<:bloodt:1533965277581017178> \`/setbanner\``,
                                `> <a:emoji_106:1536025128926978078> Change bot banner | تغيير بانر البوت`,
                                `<:bloodt:1533965277581017178> \`/setbio\` Description`,
                                `> <a:emoji_106:1536025128926978078> Change bot description | تغيير الوصف بوت`,
                                `<:bloodt:1533965277581017178> \`/setname\` Name`,
                                `> <a:emoji_106:1536025128926978078> Change bot name | تغيير اسم البوت`,
                                `<:bloodt:1533965277581017178> \`/rar\` @username or ID`,
                                `> <a:emoji_106:1536025128926978078> Remove all roles from member | للازاله جميع الرتب عن عضو`,
                                `<:bloodt:1533965277581017178> \`/prison\` @username or ID`,
                                `> <a:emoji_106:1536025128926978078> Prison member and restrict access | سجن عضو وتقييد وصوله`,
                                `<:bloodt:1533965277581017178> \`/setprison\` #channel or ID `,
                                `> <a:emoji_106:1536025128926978078> Set prison channel | للتحديد الروم المسجونين`,
                                `<:bloodt:1533965277581017178> \`/backupserver\``,
                                `> <a:emoji_106:1536025128926978078> Take a full server backup | أخذ نسخه احتياطات كامله من إعدادات وقنوات ورتب سيرفر`,
                                `<:bloodt:1533965277581017178> \`/blacklist\` add | remove @username or ID`,
                                `> <a:emoji_106:1536025128926978078> Block/unblock a member from using bot commands | منع عضو معين عن استخدام أوامر بوت نهائيا`,
                                `<:bloodt:1533965277581017178> \`/maintenance\` true | false`,
                                `> <a:emoji_106:1536025128926978078> Toggle maintenance mode | تفعيل وضع الصيانه ( تعطيل كل الأوامر موقتا لغير المالك)`,
                                `<:bloodt:1533965277581017178> \`/addalias\` alias command`,
                                `> <a:emoji_106:1536025128926978078> Add a shortcut for a command | إضافة اختصار لأمر محدد`,
                                `<:bloodt:1533965277581017178> \`/alias\``,
                                `> <a:emoji_106:1536025128926978078> Show all aliases in the server | عرض جميع الاختصارات`,
                                `<:bloodt:1533965277581017178> \`/autoreply\` trigger response`,
                                `> <a:emoji_106:1536025128926978078> Add a plain auto reply | إضافة رد تلقائي بدون إمبيد`,
                                `<:bloodt:1533965277581017178> \`/replys\``,
                                `> <a:emoji_106:1536025128926978078> Show all auto replies | عرض جميع الردود التلقائية`,
                                `<:bloodt:1533965277581017178> \`/setline\` image`,
                                `> <a:emoji_106:1536025128926978078> Set the line image | تحديد صورة الخط`,
                          ].join("\n")
                    )
                    .setTimestamp();

        case "Moderation":
              return new EmbedV2Builder()
                    .setTitle(`# 🔨 Admin Commands`)
                    .setDescription(
                          [
                                `<:bloodt:1533965277581017178> \`/kick\` @username or ID`,
                                `> <a:emoji_106:1536025128926978078> Kick member from server | لطرد العضو من سيرفر`,
                                `<:bloodt:1533965277581017178> \`/ban\` @username or ID`,
                                `> <a:emoji_106:1536025128926978078> Ban member from server | لحظر العضو من سيرفر`,
                                `<:bloodt:1533965277581017178> \`/massban\` IDs list`,
                                `> <a:emoji_106:1536025128926978078> Ban multiple members at once | حظر عده الأعضاء دفعه واحدة عبر القائمه`,
                                `<:bloodt:1533965277581017178> \`/unban\` @username or ID`,
                                `> <a:emoji_106:1536025128926978078> Unban member from server | لازاله الحظر عن العضو `,
                                `<:bloodt:1533965277581017178> \`/lock\` #channel or ID`,
                                `> <a:emoji_106:1536025128926978078> Lock channel | لقفل الروم ومنع بالارسال`,
                                `<:bloodt:1533965277581017178> \`/unlock\` #channel or ID`,
                                `> <a:emoji_106:1536025128926978078> Unlock channel | لفتح الروم وسماح بالارسال`,
                                `<:bloodt:1533965277581017178> \`/role\` @عضو @رتبة`,
                                `> <a:emoji_106:1536025128926978078>  Give role for member | لاضافه الرتبه لعضو`,
                                `<:bloodt:1533965277581017178> \`/addemoji\` name image`,
                                `> <a:emoji_106:1536025128926978078> To add emoji | للاضافه ايموجي في سيرفر`,
                                `<:bloodt:1533965277581017178> \`/addsticker\` name image tags`,
                                `> <a:emoji_106:1536025128926978078> To add sticker | للاضافه ستيكر في سيرفر`,
                                `<:bloodt:1533965277581017178> \`/createrole\` name`,
                                `> <a:emoji_106:1536025128926978078> To create a role | للانشاء رتبه في سيرفر`,
                                `<:bloodt:1533965277581017178> \`/dm\` @username or ID`,
                                `> <a:emoji_106:1536025128926978078> To send message a member | للارساله رساله خاصه لعضو`,
                                `<:bloodt:1533965277581017178> \`/mutevoice\` @Username or ID`,
                                `> <a:emoji_106:1536025128926978078> To give voice mute for member | للاعطاء كتم الصوتي لعضو`,
                          ].join("\n")
                    )
                    .setTimestamp();

        case "General":
              return new EmbedV2Builder()
                    .setTitle(`# 🎮 General Commands`)
                    .setDescription(
                          [
                                `<:bloodt:1533965277581017178> \`/help\``,
                                `> <a:emoji_106:1536025128926978078> To show all bot commands | لعرض جميع الاوامر بوت`,
                                `<:bloodt:1533965277581017178> \`/top\``,
                                `> <a:emoji_106:1536025128926978078> To show leadboard top | لعرض الاعضاء المتصدرين كتابيا وصوتيا`,
                                `<:bloodt:1533965277581017178> \`/rank\` @username or ID`,
                                `> <a:emoji_106:1536025128926978078> Show member rank and stats | لعرض الاحصائيات العضو والرانك`,
                                `<:bloodt:1533965277581017178> \`/user\` @عضو`,
                                `> <a:emoji_106:1536025128926978078> Show user information | لعرض معلومات العضو`,
                                `<:bloodt:1533965277581017178> \`/avatar\` @username or ID`,
                                `> <a:emoji_106:1536025128926978078> Show avatar and banner | لعرض الافتار وبانر مستخدم`,
                                `<:bloodt:1533965277581017178> \`/roles\``,
                                `> <a:emoji_106:1536025128926978078> To show all roles in server | لعرض جميع الرتب `,
                                `<:bloodt:1533965277581017178> \`/invites\` @username or ID`,
                                `> <a:emoji_106:1536025128926978078> Show member invites info | عرض عدد الدعوات الخاصه بعضو المعين مع جميع معلومات`,
                                `<:bloodt:1533965277581017178> \`/nick\` @username or ID`,
                                `> <a:emoji_106:1536025128926978078> Change nick from member | للتغير لقب العضو`,
                                `<:bloodt:1533965277581017178> \`/serverinfo\``,
                                `> <a:emoji_106:1536025128926978078> To Show all server inforamtion | لعرض جميع المعلومات سيرفر`,
                                `<:bloodt:1533965277581017178> \`/afk\`(Reason)`,
                                `> <a:emoji_106:1536025128926978078> Set your status to AFK | ضع حالتك كغئاب`,
                                `<:bloodt:1533965277581017178> \`/snipe\``,
                                `> <a:emoji_106:1536025128926978078> Show last deletes message | لعرض اخر الرساله المحزوفة`,
                          ].join("\n")
                    )
                    .setTimestamp();

        case "Admin":
              return new EmbedV2Builder()
                    .setTitle(`⚙️ Moderation Commands`)
                    .setDescription(
                          [
                                `<:bloodt:1533965277581017178> \`/clear\` (Amount)`,
                                `> <a:emoji_106:1536025128926978078> To clear messages | لحزف الرسالات ( حد اقصى 500)`,
                                `<:bloodt:1533965277581017178> \`/warn\` @username or ID and reason`,
                                `> <a:emoji_106:1536025128926978078> warn a member and regestried them in list | للتحذير العضو وتسجيله في قائمة تحذيرات`,
                                `<:bloodt:1533965277581017178> \`/warnings\` @username or ID`,
                                `> <a:emoji_106:1536025128926978078> Show all warnings from member | عرض جميع التحذيرات لعضو`,
                                `<:bloodt:1533965277581017178> \`/warns\``,
                                `> <a:emoji_106:1536025128926978078> Show  warnings list | عرض الاعضاء المحذورين `,
                                `<:bloodt:1533965277581017178> \`/unban\` <أيدي أو يوزرنيم>`,
                                `> <a:emoji_106:1536025128926978078> Unban member from server | لـ فك الحظر عن عضو`,
                                `<:bloodt:1533965277581017178> \`/move\` @username and voice room ID`,
                                `> <a:emoji_106:1536025128926978078> Move member to voice | للسحب عضو الى روم الصوتي`,
                                `<:bloodt:1533965277581017178> \`/hide\``,
                                `> <a:emoji_106:1536025128926978078> To hide channel | للاخفاء الروم`,
                                `<:bloodt:1533965277581017178> \`/hideall\``,
                                `> <a:emoji_106:1536025128926978078> To hide all channels | للاخفاء جميع الرومات`,
                                `<:bloodt:1533965277581017178> \`/unhide\``,
                                `> <a:emoji_106:1536025128926978078> لإظهار الروم بشكل كامل`,
                                `<:bloodt:1533965277581017178> \`/autoresponder\``,
                                `> <a:emoji_106:1536025128926978078> لإضافة رد تلقائي`,
                                `<:bloodt:1533965277581017178> \`/line\` أو \`-خط\``,
                                `> <a:emoji_106:1536025128926978078> Send the line image | إرسال صورة الخط`,
                          ].join("\n")
                    )
                    .setTimestamp();

        case "Welcome":
              return new EmbedV2Builder()
                    .setTitle(`🎊 Welcome & Leave Commands`)
                    .setDescription(
                          [
                                `<:wlc:1536191275441721455> \`/setwelcome\` #channel or ID`,
                                `> <a:emoji_106:1536025128926978078> Set welcome channel | لتحديد روم الترحيب`,
                                `<:wlc:1536191275441721455> \`/setleave\` #channel or ID`,
                                `> <a:emoji_106:1536025128926978078> Set leave channel | لتحديد روم المغادرة`,
                                `<:wlc:1536191275441721455> \`/welcomemsg\` Message`,
                                `> <a:emoji_106:1536025128926978078> Set custom welcome message | لتعيين رسالة ترحيب مخصصة`,
                                `<:wlc:1536191275441721455> \`/leavemsg\` Message`,
                                `> <a:emoji_106:1536025128926978078> Set custom leave message | لتعيين رسالة مغادرة مخصصة`,
                          ].join("\n")
                    )
                    .setTimestamp();

        default:
              return new EmbedV2Builder()
                    .setTitle(`❓ فئة غير موجودة`)
                    .setTimestamp();
  }
}

function buildHelpMenu(userId = "") {
  const menu = new StringSelectMenuBuilder()
        .setCustomId(`help_menu_${userId}`)
        .setPlaceholder("اختر فئة لعرض الأوامر")
        .addOptions([
              {
                    label: "Owner Commands",
                    emoji: "<:tag:1498134303148740658>",
                    description: "Commands for only owner bot",
                    value: "Owner",
              },
              {
                    label: "Admin Commands",
                    emoji: "<:IMG_512:1498143061249626142>",
                    description: "Commands for server administration",
                    value: "Moderation",
              },
              {
                    label: "General Commands",
                    emoji: "<:IMG_5343:1498142858987966495>",
                    description: "General Purpose Commands",
                    value: "General",
              },
              {
                    label: "Moderation Commands",
                    emoji: "<a:mod:1536030617266036766>",
                    description: "Commands for Moderation Server",
                    value: "Admin",
              },
              {
                    label: "Welcome Commands",
                    emoji: "<:wlc:1536191275441721455>",
                    description: "Welcome & Leave Configuration",
                    value: "Welcome",
              },

        ]);
  return [new ActionRowBuilder().addComponents(menu)];
}

function buildRolesEmbed(allRoles, page, totalPages) {
  const PAGE_SIZE = 20;
  const start = (page - 1) * PAGE_SIZE;
  const slice = allRoles.slice(start, start + PAGE_SIZE);

  const description = slice
        .map((r, i) => `**${start + i + 1}.** ${r} \`(${r.id})\``)
        .join("\n");

  return new EmbedV2Builder()
        .setTitle(`📜 Server Roles List - [${allRoles.length}]`)
        .setDescription(description)
        .setFooter({ text: `Page ${page} of ${totalPages}` })
        .setTimestamp();
}

function buildRolesButtons(page, totalPages) {
  const prev = new ButtonBuilder()
        .setCustomId(`roles_page_${page - 1}`)
        .setLabel("◀")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 1);

  const next = new ButtonBuilder()
        .setCustomId(`roles_page_${page + 1}`)
        .setLabel("▶")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages);

  return [new ActionRowBuilder().addComponents(prev, next)];
}

function getLiveVoiceExtra(userId, guildId) {
  const key = guildId ? `${guildId}:${userId}` : userId;
  const vData = voiceStats.get(key);
  if (!vData || !vData.joinedAt) return 0;
  return (Date.now() - vData.joinedAt) / 60000;
}

function formatVoiceMinutesDetailed(minutes) {
  if (minutes < 1) return "0s";
  const totalSec = Math.floor(minutes * 60);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h:${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m&${s}s`;
  return `${s}s`;
}

function ensureMsgStatsAllTime(userId, guildId) {
  const s = ensureMsgStats(userId, guildId);
  if (typeof s.totalCount !== "number")
        s.totalCount = s.todayCount + s.weekCount;
  return s;
}

function ensureVoiceStatsAllTime(userId, guildId) {
  const s = ensureVoiceStats(userId, guildId);
  if (typeof s.totalMinutes !== "number")
        s.totalMinutes = s.dayMinutes + s.weekMinutes;
  return s;
}

// showText / showVoice تحكّم في إظهار قسم النص أو الصوت
function buildLeaderboardEmbed(guild, type, requesterId, { showText = true, showVoice = true } = {}) {
  const members = guild.members.cache;
  const guildId = guild.id;
  const prefix = `${guildId}:`;

  const getMsgCount = (id) => {
        const s = msgStats.get(`${prefix}${id}`);
        if (!s) return 0;
        if (type === "day") return s.todayCount || 0;
        if (type === "week") return s.weekCount || 0;
        return (s.totalCount || 0) + (s.todayCount || 0) + (s.weekCount || 0);
  };

  const getVoiceMinutes = (id) => {
        const s = voiceStats.get(`${prefix}${id}`);
        if (!s) return 0;
        const live = getLiveVoiceExtra(id, guildId);
        if (type === "day") return (s.dayMinutes || 0) + live;
        if (type === "week") return (s.weekMinutes || 0) + live;
        return (
              (s.totalMinutes || 0) +
              (s.dayMinutes || 0) +
              (s.weekMinutes || 0) +
              live
        );
  };

  const guildMsgKeys = [...msgStats.keys()].filter((k) =>
        k.startsWith(prefix)
  );
  const guildVoiceKeys = [...voiceStats.keys()].filter((k) =>
        k.startsWith(prefix)
  );
  const allIds = new Set([
        ...guildMsgKeys.map((k) => k.slice(prefix.length)),
        ...guildVoiceKeys.map((k) => k.slice(prefix.length)),
  ]);

  const textSorted = [...allIds]
        .map((id) => ({ id, count: getMsgCount(id) }))
        .sort((a, b) => b.count - a.count);
  const voiceSorted = [...allIds]
        .map((id) => ({ id, minutes: getVoiceMinutes(id) }))
        .sort((a, b) => b.minutes - a.minutes);

  const textLines = textSorted.slice(0, 5).map((e, i) => {
        const m = members.get(e.id);
        return `🔶 | **#${i + 1}** ${m ? `<@${m.id}>` : `<@${e.id}>`} - Messages: **${e.count}**`;
  });
  const requesterTextIdx = textSorted.findIndex((e) => e.id === requesterId);
  if (requesterTextIdx >= 5) {
        const m = members.get(requesterId);
        textLines.push(
              `🔹 | **#${requesterTextIdx + 1}** ${m ? `<@${m.id}>` : `<@${requesterId}>`} - Messages: **${textSorted[requesterTextIdx].count}**`
        );
  }

  const voiceLines = voiceSorted.slice(0, 5).map((e, i) => {
        const m = members.get(e.id);
        return `🔶 | **#${i + 1}** ${m ? `<@${m.id}>` : `<@${e.id}>`} - Time: **${formatVoiceMinutesDetailed(e.minutes)}**`;
  });
  const requesterVoiceIdx = voiceSorted.findIndex((e) => e.id === requesterId);
  if (requesterVoiceIdx >= 5) {
        const m = members.get(requesterId);
        voiceLines.push(
              `🔹 | **#${requesterVoiceIdx + 1}** ${m ? `<@${m.id}>` : `<@${requesterId}>`} - Time: **${formatVoiceMinutesDetailed(voiceSorted[requesterVoiceIdx].minutes)}**`
        );
  }

  const typeLabel =
        type === "day" ? "Last 24h" : type === "week" ? "This Week" : "All Time";
  const typeEmoji = type === "day" ? "📊" : type === "week" ? "📅" : "🏆";
  const requesterMember = members.get(requesterId);

  const sections = [];

  if (showText) {
        sections.push(
              [`### <:emoji_105:1533965298988744844> TOP TEXT`,
               textLines.length > 0 ? textLines.join("\n\n") : "*لا توجد بيانات بعد*",
              ].join("\n")
        );
  }

  if (showVoice) {
        sections.push(
              [`### <:voicerealm:1510793780276760596> TOP VOICE`,
               voiceLines.length > 0 ? voiceLines.join("\n\n") : "*لا توجد بيانات بعد*",
              ].join("\n")
        );
  }

  return new EmbedV2Builder()
        .setTitle(`## ${typeEmoji} Server Leaderboard (${typeLabel})`)
        .setDescription(
              [...sections, ``, `-# ${typeLabel} • Requested By ${requesterMember?.displayName || requesterId}`].join("\n\n")
        )
        .setTimestamp();
}

function buildLeaderboardComponents() {
  const menu = new StringSelectMenuBuilder()
        .setCustomId("top_select_type")
        .setPlaceholder("اختر فترة الـ Top…")
        .addOptions([
              {
                    label: "All Time (Both)",
                    emoji: "🏆",
                    description: "To show all top (both)",
                    value: "alltime",
              },
              {
                    label: "Today (Both)",
                    emoji: "📅",
                    description: "today's top users",
                    value: "day",
              },
              {
                    label: "Weekly (Both)",
                    emoji: "🗓️",
                    description: "Show weekly's top users",
                    value: "week",
              },
        ]);

  return [new ActionRowBuilder().addComponents(menu)];
}

client.once("ready", async () => {
  console.log(`✅ Your bot is online , project By : DingeR : @u5j5 : ${client.user.tag}`);
  client.user.setActivity("/help | BloodPremium", { type: 3 });
  client.startTime = Date.now();

  for (const [, guild] of client.guilds.cache) {
        await cacheGuildInvites(guild);
  }

  // ── تسجيل السلاش كوماند لكل سيرفر (guild commands = تشتغل فوراً) ──
  const rest = new REST({ version: "10" }).setToken(config.token);
  for (const [, guild] of client.guilds.cache) {
        try {
              await rest.put(
                    Routes.applicationGuildCommands(client.user.id, guild.id),
                    { body: slashCommands }
              );
              console.log(`✅ [SLASH] تم تسجيل الأوامر في سيرفر: ${guild.name}`);
        } catch (e) {
              console.error(`❌ [SLASH] فشل التسجيل في ${guild.name}:`, e.message);
        }
  }
});

client.on("guildCreate", async (guild) => {
  await cacheGuildInvites(guild);
  // تسجيل الأوامر في السيرفر الجديد
  try {
        const rest = new REST({ version: "10" }).setToken(token);
        await rest.put(
              Routes.applicationGuildCommands(client.user.id, guild.id),
              { body: slashCommands }
        );
        console.log(`✅ [SLASH] تم تسجيل الأوامر في سيرفر جديد: ${guild.name}`);
  } catch (e) {
        console.error(`❌ [SLASH] فشل التسجيل في ${guild.name}:`, e.message);
  }
});

client.on("inviteCreate", async (invite) => {
  const map = inviteCache.get(invite.guild.id) || new Map();
  map.set(invite.code, invite.uses || 0);
  inviteCache.set(invite.guild.id, map);
});

client.on("inviteDelete", async (invite) => {
  const map = inviteCache.get(invite.guild.id);
  if (map) map.delete(invite.code);
});

// ── أزرار عارض الصورة / البانر ──
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith("avatarview_")) return;

  const [, mode, userId, requesterId] = interaction.customId.split("_");

  if (interaction.user.id !== requesterId) {
        return interaction.reply({
              content: `❌ **هذا الطلب مخصص لمن قام به فقط.**`,
              flags: MessageFlags.Ephemeral,
        });
  }

  const targetUser = await client.users.fetch(userId, { force: true }).catch(() => null);
  if (!targetUser) {
        return interaction.reply({
              content: `❌ **تعذّر جلب المستخدم.**`,
              flags: MessageFlags.Ephemeral,
        });
  }
  const targetMember = await interaction.guild.members.fetch(userId).catch(() => null);

  const payload = await buildAvatarView(targetUser, targetMember, interaction.user, mode);
  await interaction.update(payload).catch(() => {});
});

client.on("interactionCreate", async (interaction) => {
  // ── Help menu (مع حماية userId) ──
  if (
        interaction.isStringSelectMenu() &&
        interaction.customId.startsWith("help_menu_")
  ) {
        const ownerId = interaction.customId.replace("help_menu_", "");
        if (ownerId && interaction.user.id !== ownerId) {
              await interaction.reply({
                    content: `❌ **هذه القائمة مخصصة لمن طلبها فقط.**`,
                    flags: MessageFlags.Ephemeral,
              });
              return;
        }
        const category = interaction.values[0];
        const embed = buildHelpEmbed(category, interaction.user);
        const mainComp = embed
              ? embed.toContainer()
              : new TextDisplayBuilder().setContent(buildHelpMainText(interaction.user));
        await interaction.update({
              components: [mainComp, ...buildHelpMenu(ownerId)],
              flags: MessageFlags.IsComponentsV2,
        });
        return;
  }

  // ── Help menu ──
  if (
        interaction.isStringSelectMenu() &&
        interaction.customId === "help_menu"
  ) {
        const category = interaction.values[0];
        const embed = buildHelpEmbed(category, interaction.user);
        const mainComp = embed
              ? embed.toContainer()
              : new TextDisplayBuilder().setContent(buildHelpMainText(interaction.user));
        await interaction.update({
              components: [mainComp, ...buildHelpMenu()],
              flags: MessageFlags.IsComponentsV2,
        });
        return;
  }

  // ── Leaderboard: select menu ──
  if (
        interaction.isStringSelectMenu() &&
        interaction.customId === "top_select_type"
  ) {
        const type = interaction.values[0];
        const topEmbed = buildLeaderboardEmbed(
              interaction.guild,
              type,
              interaction.user.id
        );
        await interaction.update(v2Payload(topEmbed, buildLeaderboardComponents()));
        return;
  }

  // ── Log Setting: زر "تعديل اللوق" ──







  // ── Roles pagination ──
  if (
        interaction.isButton() &&
        interaction.customId.startsWith("roles_page_")
  ) {
        const page = parseInt(interaction.customId.replace("roles_page_", ""));
        const guild = interaction.guild;
        const PAGE_SIZE = 20;

        const allRoles = [
              ...guild.roles.cache
                    .filter((r) => r.name !== "@everyone")
                    .sort((a, b) => b.position - a.position)
                    .values(),
        ];

        const totalPages = Math.ceil(allRoles.length / PAGE_SIZE);
        const safePage = Math.max(1, Math.min(page, totalPages));

        await interaction.update(
              v2Payload(
                    buildRolesEmbed(allRoles, safePage, totalPages),
                    buildRolesButtons(safePage, totalPages)
              )
        );
        return;
  }

});

// ══════════════════════════════════════════════════════
//  SLASH COMMANDS HANDLER
// ══════════════════════════════════════════════════════
async function handleSlashLikeCommand(interaction) {
  const { commandName } = interaction;

  // ── فحص القائمة السوداء (Blacklist) ──
  if (interaction.guild) {
        const blSet = blacklistDB.get(interaction.guild.id);
        if (blSet && blSet.has(interaction.user.id) && interaction.user.id !== OWNER_ID) {
              return interaction.reply({ content: `🚫 **تم حظرك من استخدام أوامر البوت في هذا السيرفر.**`, flags: MessageFlags.Ephemeral }).catch(() => {});
        }
  }

  // ── فحص وضع الصيانة (Maintenance Mode) ──
  if (interaction.guild && commandName !== "maintenance") {
        const isMaintenance = maintenanceDB.get(interaction.guild.id);
        const isBypass = interaction.user.id === OWNER_ID || interaction.member.permissions.has(PermissionFlagsBits.Administrator);
        if (isMaintenance && !isBypass) {
              return interaction.reply({ content: `🛠️ **البوت في وضع الصيانة حاليًا، يرجى المحاولة لاحقًا.**`, flags: MessageFlags.Ephemeral }).catch(() => {});
        }
  }

  try {
        // ── /help ──
        if (commandName === "help") {
              const helpContainer = new ContainerBuilder().setAccentColor(0x8B0000);
              helpContainer.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(buildHelpMainText(interaction.user))
              );
              await interaction.reply({
                    components: [helpContainer, ...buildHelpMenu(interaction.user.id)],
                    flags: MessageFlags.IsComponentsV2,
              });
        }

        // ── /top ──
        else if (commandName === "top") {
              const period = interaction.options.getString("period") || "alltime";
              const topEmbed = buildLeaderboardEmbed(interaction.guild, period, interaction.user.id);
              await interaction.reply(v2Payload(topEmbed, buildLeaderboardComponents()));
        }



        // ── /user ──
        else if (commandName === "user") {
              const member = (await getTargetMember(interaction, "member")) || interaction.member;
              const roles = member.roles.cache
                    .filter((r) => r.name !== "@everyone")
                    .sort((a, b) => b.position - a.position)
                    .map((r) => `${r}`)
                    .join(" ") || "لا توجد رتب";
              const rolesValue = roles.length > 1024 ? roles.slice(0, 1021) + "..." : roles;
              const targetAvatar = member.displayAvatarURL({ size: 256, extension: "png" });
              const embed = new EmbedV2Builder()
                    .setAuthor({ name: `طلب بواسطة ${interaction.member.displayName}`, iconURL: interaction.member.displayAvatarURL({ size: 64, extension: "png" }) })
                    .setTitle(`👤 معلومات ${member.displayName}`)
                    .setThumbnail(targetAvatar)
                    .addFields(
                          { name: "المستخدم :", value: `${member.user.tag}`, inline: true },
                          { name: "ايدي الحساب :", value: `\`${member.id}\``, inline: true },
                          { name: "بوت؟", value: member.user.bot ? "نعم ✅" : "لا ❌", inline: true },
                          { name: "تاريخ انشاء الحساب :", value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:D>`, inline: true },
                          { name: "تاريخ انضمام سيرفر:", value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>`, inline: true },
                          { name: "لون الرتبة :", value: `\`${member.displayHexColor}\``, inline: true },
                          { name: `الرتب (${member.roles.cache.size - 1})`, value: rolesValue, inline: false }
                    )
                    .setTimestamp();
              await interaction.reply(v2Payload(embed));
        }

        // ── /serverinfo ──
        else if (commandName === "serverinfo") {
              const g = interaction.guild;
              const owner = await g.fetchOwner();
              const iconURL = g.iconURL({ size: 256, extension: "png" });
              const bannerURL = g.bannerURL({ size: 1024, extension: "png" });
              const textChannels = g.channels.cache.filter((c) => c.type === 0).size;
              const voiceChannels = g.channels.cache.filter((c) => c.type === 2).size;
              const categories = g.channels.cache.filter((c) => c.type === 4).size;
              const embed = new EmbedV2Builder()
                    .setTitle(`🌐 معلومات سيرفر ${g.name}`)
                    .setThumbnail(iconURL)
                    .addFields(
                          { name: "المالك :", value: `${owner}`, inline: true },
                          { name: "الايدي :", value: `\`${g.id}\``, inline: true },
                          { name: "عدد الاعضاء :", value: `${g.memberCount}`, inline: true },
                          { name: "الرومات الكتابية :", value: `${textChannels}`, inline: true },
                          { name: "الرومات الصوتية :", value: `${voiceChannels}`, inline: true },
                          { name: "عدد الكاتيجوري :", value: `${categories}`, inline: true },
                          { name: "الرتب :", value: `${g.roles.cache.size}`, inline: true },
                          { name: "تاريخ الانشاء :", value: `<t:${Math.floor(g.createdTimestamp / 1000)}:D>`, inline: true }
                    )
                    .setTimestamp();
              if (bannerURL) embed.setImage(bannerURL);
              await interaction.reply(v2Payload(embed));
        }

        // ── /avatar ──
        else if (commandName === "avatar") {
              const user = interaction.options.getUser("member") || interaction.user;
              const member = (await getTargetMember(interaction, "member")) || interaction.member;
              const targetUser = await client.users.fetch(user.id, { force: true }).catch(() => user);
              const payload = await buildAvatarView(targetUser, member, interaction.user, "avatar");
              await interaction.reply(payload);
        }

        // ── /roles ──
        else if (commandName === "roles") {
              const PAGE_SIZE = 20;
              const allRoles = [...interaction.guild.roles.cache
                    .filter((r) => r.name !== "@everyone")
                    .sort((a, b) => b.position - a.position)
                    .values()];
              const totalPages = Math.ceil(allRoles.length / PAGE_SIZE);
              const page = Math.max(1, Math.min(interaction.options.getInteger("page") || 1, totalPages));
              await interaction.reply(v2Payload(buildRolesEmbed(allRoles, page, totalPages), buildRolesButtons(page, totalPages)));
        }

        // ── /invites ──
        else if (commandName === "invites") {
              const member = (await getTargetMember(interaction, "member")) || interaction.member;
              await interaction.deferReply();
              const invites = await interaction.guild.invites.fetch().catch(() => null);
              if (!invites) return interaction.editReply({ content: `❌ تعذّر جلب الدعوات، تأكد من صلاحية Manage Server.` });
              const memberInvites = invites.filter((inv) => inv.inviter?.id === member.id);
              const totalUses = memberInvites.reduce((acc, inv) => acc + (inv.uses || 0), 0);
              const list = memberInvites.size
                    ? memberInvites.map((inv) => `- \`${inv.code}\` — **${inv.uses || 0}** استخدام${inv.maxUses ? ` (الحد الأقصى: ${inv.maxUses})` : ""}${inv.channel ? ` — ${inv.channel}` : ""}`).join("\n")
                    : "لا يوجد لديه أي دعوات نشطة حاليًا.";
              const embed = new EmbedV2Builder()
                    .setColor(0x8B0000)
                    .setTitle(`📨 معلومات دعوات ${member.displayName}`)
                    .setThumbnail(member.displayAvatarURL({ size: 256, extension: "png" }))
                    .addFields(
                          { name: "العضو :", value: `${member}`, inline: true },
                          { name: "إجمالي عدد الدعوات :", value: `${memberInvites.size}`, inline: true },
                          { name: "إجمالي مرات الاستخدام :", value: `${totalUses}`, inline: true },
                          { name: "تفاصيل الدعوات :", value: list.length > 1024 ? list.slice(0, 1021) + "..." : list },
                    )
                    .setTimestamp();
              await interaction.editReply(v2Payload(embed));
        }

        // ── /afk ──
        else if (commandName === "afk") {
              const reason = interaction.options.getString("reason") || "AFK";
              const afkKey = `${interaction.guild.id}:${interaction.user.id}`;
              afkMap.set(afkKey, { 
                    reason, 
                    timestamp: Date.now(),
                    mentions: [] // لتخزين الأشخاص الذين منشنوا صاحب AFK
              });
              const AFK_EMOJI = "<:afk:1537214034158420029>";
              const container = new ContainerBuilder().setAccentColor(0x9C27B0);
              container.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`${AFK_EMOJI} **انت الآن في الوضع AFK !**`)
              );
              await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // ── /snipe ──
        else if (commandName === "snipe") {
              const data = snipeMap.get(interaction.channel.id);
              if (!data) {
                    const container = new ContainerBuilder().setAccentColor(0xED4245);
                    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`❌ **No deleted messages found in this channel.**`));
                    return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2, flags: MessageFlags.Ephemeral });
              }
              const elapsed = Math.floor((Date.now() - data.timestamp) / 1000);
              const timeText = elapsed < 60 ? `${elapsed}s ago` : elapsed < 3600 ? `${Math.floor(elapsed / 60)}m ago` : `${Math.floor(elapsed / 3600)}h ago`;
              const container = new ContainerBuilder().setAccentColor(0x2B2D31);
              container.addSectionComponents(
                    new SectionBuilder()
                          .addTextDisplayComponents(
                                new TextDisplayBuilder().setContent(
                                      `**🤖 ${data.authorTag}**\n${data.content || "*[No text content]*"}\n\n-# 🕐 ${timeText}`
                                )
                          )
                          .setThumbnailAccessory(
                                new ThumbnailBuilder().setURL(data.authorAvatar || "https://cdn.discordapp.com/embed/avatars/0.png")
                          )
              );
              if (data.imageURL) {
                    container.addMediaGalleryComponents(
                          new MediaGalleryBuilder().addItems(
                                new MediaGalleryItemBuilder().setURL(data.imageURL)
                          )
                    );
              }
              await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }

        // ── /kick ──
        else if (commandName === "kick") {
              if (!requirePermSlash(interaction, PermissionFlagsBits.KickMembers)) return;
              const member = await getTargetMember(interaction, "member");
              if (!member) return interaction.reply({ content: `❌ لم يتم العثور على هذا العضو بالسيرفر.`, flags: MessageFlags.Ephemeral });
              const reason = interaction.options.getString("reason") || "Unknown reason";
              await member.kick(reason);
              await interaction.reply({ content: `**(${member.user.username}) Has been kicked from server !✅**\n\`Reason\` : ${reason}` });
              await sendModLog(interaction.guild, { action: "طرد (Kick)", moderator: interaction.user, target: member.user, reason });
        }

        // ── /ban ──
        else if (commandName === "ban") {
              if (!requirePermSlash(interaction, PermissionFlagsBits.BanMembers)) return;
              const member = await getTargetMember(interaction, "member");
              if (!member) return interaction.reply({ content: `❌ لم يتم العثور على هذا العضو بالسيرفر.`, flags: MessageFlags.Ephemeral });
              const reason = interaction.options.getString("reason") || "Unknown reason";
              await member.ban({ reason });
              await interaction.reply({ content: `**(${member.user.username}) Has been banned from server !✅**\n\`Reason\` : ${reason}` });
              await sendModLog(interaction.guild, { action: "حظر (Ban)", moderator: interaction.user, target: member.user, reason });
        }

        // ── /massban ──
        else if (commandName === "massban") {
              if (!requirePermSlash(interaction, PermissionFlagsBits.BanMembers)) return;
              const raw = interaction.options.getString("users");
              const reason = interaction.options.getString("reason") || "Mass ban | حظر جماعي";
              const ids = Array.from(new Set((raw.match(/\d{15,25}/g) || [])));
              if (!ids.length) return interaction.reply({ content: `❌ لم يتم العثور على أي أيدي صالح داخل القائمة.`, flags: MessageFlags.Ephemeral });
              await interaction.deferReply();
              let success = 0, failed = 0;
              for (const id of ids) {
                    await interaction.guild.members.ban(id, { reason }).then(() => success++).catch(() => failed++);
              }
              await interaction.editReply({ content: `✅ **تم حظر ${success} عضو بنجاح.**${failed ? `\n❌ **فشل حظر ${failed} عضو.**` : ""}` });
              await sendModLog(interaction.guild, { action: "حظر جماعي (Mass Ban)", moderator: interaction.user, target: null, reason, extra: `العدد المستهدف: ${ids.length} | نجح: ${success} | فشل: ${failed}` });
        }

        // ── /unban ──
        else if (commandName === "unban") {
              if (!requirePermSlash(interaction, PermissionFlagsBits.BanMembers)) return;
              const query = interaction.options.getString("user");
              let resolvedUser = null;
              let displayName = query;
              try {
                    const bans = await interaction.guild.bans.fetch();
                    if (/^\d{17,20}$/.test(query)) {
                          const entry = bans.get(query);
                          if (entry) { resolvedUser = entry.user; displayName = `**${entry.user.username}**`; }
                    } else {
                          const lq = query.toLowerCase().replace(/^@/, "");
                          const entry = bans.find((b) => b.user.username.toLowerCase() === lq || b.user.tag.toLowerCase() === lq || b.user.globalName?.toLowerCase() === lq);
                          if (entry) { resolvedUser = entry.user; displayName = `**${entry.user.username}**`; }
                    }
              } catch {}
              const targetId = resolvedUser?.id || query;
              await interaction.guild.members.unban(targetId).catch(() => { throw new Error("المستخدم غير موجود في قائمة المحظورين أو المعرف غير صحيح."); });
              await interaction.reply({ content: `✅ تم تفكيك الباند ${displayName}` });
              await sendModLog(interaction.guild, { action: "رفع الحظر (Unban)", moderator: interaction.user, target: resolvedUser || { id: targetId, tag: query, displayAvatarURL: () => null }, reason: "رفع حظر يدوي" });
        }

        // ── /warn ──
        else if (commandName === "warn") {
              if (!requirePermSlash(interaction, PermissionFlagsBits.ManageMessages)) return;
              const member = await getTargetMember(interaction, "member");
              if (!member) return interaction.reply({ content: `❌ لم يتم العثور على هذا العضو بالسيرفر.`, flags: MessageFlags.Ephemeral });
              const reason = interaction.options.getString("reason");
              const shortId = Math.random().toString(36).substring(2, 8).toUpperCase();
              const warnKey = `${interaction.guild.id}:${member.id}`;
              if (!warningsDB.has(warnKey)) warningsDB.set(warnKey, []);
              warningsDB.get(warnKey).push({ id: shortId, reason, moderatorId: interaction.user.id, moderatorTag: interaction.user.tag, timestamp: Date.now() });
              saveWarnings();
              await interaction.reply({ content: `✅ Warned ${member} for: **${reason}** (ID: \`${shortId}\`)` });
              await sendModLog(interaction.guild, { action: "تحذير (Warn)", moderator: interaction.user, target: member.user, reason, extra: `إجمالي التحذيرات: ${warningsDB.get(warnKey).length}` });
              await member.send({ content: `⚠️ You have received a warning in **${interaction.guild.name}**\n> **Reason:** ${reason}\n> **Issued by:** ${interaction.user.username}` }).catch(() => {});
        }

        // ── /warnings ──
        else if (commandName === "warnings") {
              if (!requirePermSlash(interaction, PermissionFlagsBits.ManageMessages)) return;
              const member = (await getTargetMember(interaction, "member")) || interaction.member;
              const warnKey = `${interaction.guild.id}:${member.id}`;
              const list = warningsDB.get(warnKey) || [];
              const container = new ContainerBuilder().setAccentColor(0xFFA500);
              const titleLine = `**${member.user.username}'s Warnings (${list.length})**`;
              if (list.length === 0) {
                    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${titleLine}\n\n✅ No warnings found.`));
              } else {
                    const lines = list.map((w, i) => {
                          const d = new Date(w.timestamp);
                          const dateStr = `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)}`;
                          return `**${i + 1}.** ID: \`${w.id || `W${i + 1}`}\` | Mod: <@${w.moderatorId}>\nReason: ${w.reason}\nDate: ${dateStr}`;
                    }).join("\n\n");
                    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${titleLine}\n\n${lines}`));
              }
              container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
              const now = new Date();
              const footerDate = `${now.getMonth() + 1}/${now.getDate()}/${String(now.getFullYear()).slice(-2)}, ${now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`;
              container.addTextDisplayComponents(new TextDisplayBuilder().setContent(footerDate));
              await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // ── /warns ──
        else if (commandName === "warns") {
              if (!requirePermSlash(interaction, PermissionFlagsBits.ManageMessages)) return;
              const warnPrefix = `${interaction.guild.id}:`;
              const guildWarns = [...warningsDB.entries()]
                    .filter(([k]) => k.startsWith(warnPrefix))
                    .map(([k, v]) => ({ userId: k.slice(warnPrefix.length), count: v.length }))
                    .filter((e) => e.count > 0)
                    .sort((a, b) => b.count - a.count);
              const totalWarnings = guildWarns.reduce((s, e) => s + e.count, 0);
              const container = new ContainerBuilder().setAccentColor(0xFFA500);
              if (guildWarns.length === 0) {
                    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`⚠️ **Server Valid Warnings List**\n\n✅ No warnings found in this server.`));
              } else {
                    const lines = guildWarns.map((e, i) => `**${i + 1}.** <@${e.userId}> : ${e.count} warning${e.count !== 1 ? "s" : ""}`).join("\n");
                    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`⚠️ **Server Valid Warnings List**\n\n${lines}`));
                    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
                    const now = new Date();
                    const footerDate = `${now.getMonth() + 1}/${now.getDate()}/${String(now.getFullYear()).slice(-2)}, ${now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`;
                    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`Total Warnings: ${totalWarnings} | ${footerDate}`));
              }
              await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // ── /move ──
        else if (commandName === "move") {
              if (!requirePermSlash(interaction, PermissionFlagsBits.MoveMembers)) return;
              const member = await getTargetMember(interaction, "member");
              if (!member) return interaction.reply({ content: `❌ لم يتم العثور على هذا العضو بالسيرفر.`, flags: MessageFlags.Ephemeral });
              const channel = interaction.options.getChannel("channel");
              if (!member.voice?.channel) return interaction.reply({ content: `❌ العضو ليس في أي قناة صوتية حالياً.`, flags: MessageFlags.Ephemeral });
              await member.voice.setChannel(channel).catch((e) => { throw new Error(`فشل النقل: ${e.message}`); });
              await interaction.reply({ content: `**${member.user.username}** تم نقله لروم الصوتي *(${channel})*` });
        }

        // ── /clear ──
        else if (commandName === "clear") {
              if (!requirePermSlash(interaction, PermissionFlagsBits.ManageMessages)) return;
              const amount = interaction.options.getInteger("amount");
              await interaction.deferReply({ ephemeral: true });
              let deletedCount = 0;
              let lastId = undefined;
              const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
              while (deletedCount < amount) {
                    const batchSize = Math.min(amount - deletedCount, 100);
                    const fetchOptions = { limit: batchSize };
                    if (lastId) fetchOptions.before = lastId;
                    const fetched = await interaction.channel.messages.fetch(fetchOptions).catch(() => null);
                    if (!fetched || fetched.size === 0) break;
                    lastId = fetched.last()?.id;
                    const recent = fetched.filter((m) => m.createdTimestamp > fourteenDaysAgo);
                    const old = fetched.filter((m) => m.createdTimestamp <= fourteenDaysAgo);
                    if (recent.size > 0) {
                          const bulk = await interaction.channel.bulkDelete(recent, true).catch(() => null);
                          if (bulk) deletedCount += bulk.size;
                    }
                    for (const [, m] of old) {
                          if (deletedCount >= amount) break;
                          await m.delete().catch(() => {});
                          deletedCount++;
                          await new Promise((r) => setTimeout(r, 300));
                    }
                    if (fetched.size < batchSize) break;
              }
              await interaction.editReply({ content: `✅ **تم مسح ${deletedCount} رسالة بنجاح.**` });
        }

        // ── /lock ──
        else if (commandName === "lock") {
              const all = interaction.options.getBoolean("all");
              if (all) {
                    if (!requirePermSlash(interaction, PermissionFlagsBits.Administrator)) return;
                    const textChannels = interaction.guild.channels.cache.filter(
                          (c) => c.type === 0 && c.permissionsFor(interaction.guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel)
                    );
                    let count = 0;
                    for (const [, ch] of textChannels) {
                          await ch.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: false }).catch(() => {});
                          count++;
                    }
                    await interaction.reply({ content: `🔒 **تم قفل ${count} قناة نصية** — لا يمكن لأحد الإرسال الآن.` });
              } else {
                    if (!requirePermSlash(interaction, PermissionFlagsBits.ManageChannels)) return;
                    await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: false });
                    await interaction.reply({ content: `🔒 **تم قفل القناة بواسطة ${interaction.user.username}**` });
              }
        }

        // ── /unlock ──
        else if (commandName === "unlock") {
              if (!requirePermSlash(interaction, PermissionFlagsBits.ManageChannels)) return;
              await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: null });
              await interaction.reply({ content: `🔓 **تم فتح القناة بواسطة ${interaction.user.username}**` });
        }

        // ── /hide ──
        else if (commandName === "hide") {
              if (!requirePermSlash(interaction, PermissionFlagsBits.Administrator)) return;
              await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { ViewChannel: false });
              const embed = new EmbedV2Builder()
                    .setColor(0x2B2D31).setTitle(`الروم مخفي الآن`)
                    .setDescription(`تم إخفاء ${interaction.channel} بشكل كامل عن جميع الأعضاء.`)
                    .addFields({ name: `الروم`, value: `${interaction.channel}`, inline: true }, { name: `المسؤول`, value: `<@${interaction.user.id}>`, inline: true })
                    .setTimestamp();
              await interaction.reply(v2Payload(embed));
        }

        // ── /unhide ──
        else if (commandName === "unhide") {
              if (!requirePermSlash(interaction, PermissionFlagsBits.Administrator)) return;
              await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { ViewChannel: null });
              const embed = new EmbedV2Builder()
                    .setColor(0x2B2D31).setTitle(`**Room is now unhided** ✅`)
                    .setDescription(`${interaction.channel} **Room has been unhided for everyone** ✅`)
                    .addFields({ name: `Room`, value: `${interaction.channel}`, inline: true }, { name: `Responsable`, value: `<@${interaction.user.id}>`, inline: true })
                    .setTimestamp();
              await interaction.reply(v2Payload(embed));
        }

        // ── /hideall ──
        else if (commandName === "hideall") {
              if (!requirePermSlash(interaction, PermissionFlagsBits.Administrator)) return;
              const allChannels = interaction.guild.channels.cache.filter(
                    (c) => (c.type === 0 || c.type === 2 || c.type === 4) && c.id !== interaction.channel.id
              );
              let count = 0;
              for (const [, ch] of allChannels) {
                    await ch.permissionOverwrites.edit(interaction.guild.roles.everyone, { ViewChannel: false }).catch(() => {});
                    count++;
              }
              await interaction.reply({ content: `🙈 **تم إخفاء ${count} قناة** — لا يمكن لأحد رؤيتها الآن.` });
        }

        // ── /embed ──
        else if (commandName === "embed") {
              if (!requirePermSlash(interaction, PermissionFlagsBits.ManageMessages)) return;
              const text = interaction.options.getString("text");
              await interaction.reply({ content: `✅ تم إرسال الرسالة.`, flags: MessageFlags.Ephemeral });
              await interaction.channel.send(v2Payload(new EmbedV2Builder().setColor(0x8B0000).setDescription(text)));
        }

        // ── /role ──
        else if (commandName === "role") {
              if (!requirePermSlash(interaction, PermissionFlagsBits.ManageRoles)) return;
              const member = await getTargetMember(interaction, "member");
              if (!member) return interaction.reply({ content: `❌ لم يتم العثور على هذا العضو بالسيرفر.`, flags: MessageFlags.Ephemeral });
              const role = interaction.options.getRole("role");
              if (member.roles.cache.has(role.id)) {
                    await member.roles.remove(role);
                    await interaction.reply({ content: `✅ تمت إزالة \`${role.name}\` من ${member}` });
              } else {
                    await member.roles.add(role);
                    await interaction.reply({ content: `✅ تمت إضافة \`${role.name}\` لـ ${member}` });
              }
        }

        // ── /nick ──
        else if (commandName === "nick") {
              if (!requirePermSlash(interaction, PermissionFlagsBits.ManageNicknames)) return;
              const member = await getTargetMember(interaction, "member");
              if (!member) return interaction.reply({ content: `❌ لم يتم العثور على هذا العضو بالسيرفر.`, flags: MessageFlags.Ephemeral });
              const name = interaction.options.getString("name");
              await member.setNickname(name);
              await interaction.reply({ content: `✅ **تم تغيير لقب ${member.user.username} إلى ${name}**` });
        }

        // ── /addemoji ──
        else if (commandName === "addemoji") {
              if (!requirePermSlash(interaction, PermissionFlagsBits.ManageEmojisAndStickers)) return;
              const name = interaction.options.getString("name");
              const image = interaction.options.getString("image");
              await interaction.deferReply();
              const emoji = await interaction.guild.emojis.create({ attachment: image, name }).catch((e) => { throw new Error(`فشل إضافة الايموجي: ${e.message}`); });
              await interaction.editReply({ content: `✅ **تم إضافة الايموجي بنجاح:** ${emoji}` });
        }

        // ── /addsticker ──
        else if (commandName === "addsticker") {
              if (!requirePermSlash(interaction, PermissionFlagsBits.ManageEmojisAndStickers)) return;
              const name = interaction.options.getString("name");
              const image = interaction.options.getString("image");
              const tags = interaction.options.getString("tags");
              const description = interaction.options.getString("description") || "";
              await interaction.deferReply();
              const sticker = await interaction.guild.stickers.create({ file: image, name, tags, description }).catch((e) => { throw new Error(`فشل إضافة الستيكر: ${e.message}`); });
              await interaction.editReply({ content: `✅ **تم إضافة الستيكر بنجاح:** \`${sticker.name}\`` });
        }

        // ── /createrole ──
        else if (commandName === "createrole") {
              if (!requirePermSlash(interaction, PermissionFlagsBits.ManageRoles)) return;
              const name = interaction.options.getString("name");
              const color = interaction.options.getString("color") || undefined;
              const isAdmin = interaction.options.getBoolean("admin") || false;
              const hoist = interaction.options.getBoolean("hoist") || false;
              const mentionable = interaction.options.getBoolean("mentionable") || false;
              const role = await interaction.guild.roles.create({
                    name,
                    color,
                    hoist,
                    mentionable,
                    permissions: isAdmin ? [PermissionFlagsBits.Administrator] : [],
                    reason: `تم الإنشاء بواسطة ${interaction.user.tag}`,
              }).catch((e) => { throw new Error(`فشل إنشاء الرتبة: ${e.message}`); });
              await interaction.reply({ content: `✅ **تم إنشاء الرتبة ${role} بنجاح${isAdmin ? " (بصلاحية Administrator)" : ""}**` });
        }

        // ── /dm ──
        else if (commandName === "dm") {
              const member = await getTargetMember(interaction, "member");
              if (!member) return interaction.reply({ content: `❌ لم يتم العثور على هذا العضو بالسيرفر.`, flags: MessageFlags.Ephemeral });
              const message = interaction.options.getString("message");
              const sent = await member.send({ content: message }).catch(() => null);
              await interaction.reply({ content: sent ? `✅ **تم إرسال الرسالة الخاصة إلى ${member.user.username} بنجاح.**` : `❌ **تعذّر إرسال رسالة خاصة لـ ${member.user.username}. قد يكون قد أغلق الرسائل الخاصة.**`, ephemeral: true });
        }

        // ── /mutevoice ──
        else if (commandName === "mutevoice") {
              if (!requirePermSlash(interaction, PermissionFlagsBits.MuteMembers)) return;
              const member = await getTargetMember(interaction, "member");
              if (!member) return interaction.reply({ content: `❌ لم يتم العثور على هذا العضو بالسيرفر.`, flags: MessageFlags.Ephemeral });
              const state = interaction.options.getBoolean("state");
              const targetState = state === null ? !member.voice.serverMute : state;
              if (!member.voice.channelId) return interaction.reply({ content: `❌ العضو غير متصل بروم صوتي.`, flags: MessageFlags.Ephemeral });
              await member.voice.setMute(targetState, `بواسطة ${interaction.user.tag}`).catch((e) => { throw new Error(`فشل تنفيذ الأمر: ${e.message}`); });
              await interaction.reply({ content: targetState ? `✅ **تم كتم ${member.user.username} صوتيًا.**` : `✅ **تم إلغاء الكتم الصوتي عن ${member.user.username}.**` });
        }

        // ── /autoresponder ──
        else if (commandName === "autoresponder") {
              if (!requirePermSlash(interaction, PermissionFlagsBits.ManageGuild)) return;
              const sub = interaction.options.getSubcommand();
              if (sub === "add") {
                    const trigger = interaction.options.getString("trigger");
                    const response = interaction.options.getString("response");
                    const list = autoresponders.get(interaction.guild.id) || [];
                    const existing = list.find((a) => a.trigger.toLowerCase() === trigger.toLowerCase());
                    if (existing) { existing.response = response; } else { list.push({ trigger, response }); }
                    autoresponders.set(interaction.guild.id, list);
                    saveAutoresponders();
                    const embed = new EmbedV2Builder().setColor(0x2B2D31).setTitle(`**auto response added successfully ✅**`)
                          .addFields({ name: `Key word:`, value: `\`${trigger}\``, inline: true }, { name: `Response:`, value: response, inline: true })
                          .setTimestamp();
                    await interaction.reply(v2Payload(embed));
              } else if (sub === "remove") {
                    const trigger = interaction.options.getString("trigger");
                    const list = autoresponders.get(interaction.guild.id) || [];
                    const filtered = list.filter((a) => a.trigger.toLowerCase() !== trigger.toLowerCase());
                    if (filtered.length === list.length) return interaction.reply({ content: `❌ لا يوجد رد تلقائي بهذه الكلمة.`, flags: MessageFlags.Ephemeral });
                    autoresponders.set(interaction.guild.id, filtered);
                    saveAutoresponders();
                    await interaction.reply({ content: `✅ تم حذف الرد التلقائي للكلمة \`${trigger}\`` });
              } else if (sub === "list") {
                    const list = autoresponders.get(interaction.guild.id) || [];
                    const embed = new EmbedV2Builder().setColor(0x2B2D31).setTitle(`Auto Responses — ${interaction.guild.name}`)
                          .setDescription(list.length ? list.map((a, i) => `**${i + 1}.** \`${a.trigger}\` ← ${a.response}`).join("\n") : "لا توجد ردود تلقائية.").setTimestamp();
                    await interaction.reply(v2Payload(embed));
              }
        }

        // ── /addalias ──
        else if (commandName === "addalias") {
              if (!requireOwnerSlash(interaction)) return;
              const alias = interaction.options.getString("alias").trim().toLowerCase().replace(/^-+/, "");
              const command = interaction.options.getString("command").trim().toLowerCase().replace(/^-+/, "");
              const commandDef = findSlashCommandDef(command);
              if (!/^[\p{L}\p{N}_-]{1,32}$/u.test(alias)) {
                    return interaction.reply({ content: `❌ الاختصار يجب أن يكون كلمة واحدة من 1 إلى 32 حرفًا.`, flags: MessageFlags.Ephemeral });
              }
              if (!commandDef) {
                    return interaction.reply({ content: `❌ الأمر \`${command}\` غير موجود. استخدم اسم أمر موجود مثل \`ban\` أو \`clear\`.`, flags: MessageFlags.Ephemeral });
              }
              const aliases = Array.isArray(aliasesDB.get(interaction.guild.id)) ? aliasesDB.get(interaction.guild.id) : [];
              const existing = aliases.find((a) => a.alias === alias);
              if (existing) existing.command = commandDef.name;
              else aliases.push({ alias, command: commandDef.name });
              aliasesDB.set(interaction.guild.id, aliases);
              saveAliases();
              await interaction.reply({ content: `✅ تم حفظ الاختصار \`-${alias}\` للأمر \`-${commandDef.name}\`.` });
        }

        // ── /alias ──
        else if (commandName === "alias") {
              if (!requireOwnerSlash(interaction)) return;
              const aliases = aliasesDB.get(interaction.guild.id) || [];
              const text = aliases.length
                    ? aliases.map((a, i) => `**${i + 1}.** \`-${a.alias}\` ← \`-${a.command}\``).join("\n")
                    : "لا توجد اختصارات مضافة في هذا السيرفر.";
              await interaction.reply({ content: `**اختصارات السيرفر ${interaction.guild.name}**\n${text}` });
        }

        // ── /autoreply و /replys ──
        else if (commandName === "autoreply") {
              if (!requireOwnerSlash(interaction)) return;
              const trigger = interaction.options.getString("trigger").trim();
              const response = interaction.options.getString("response");
              const list = autoresponders.get(interaction.guild.id) || [];
              const existing = list.find((a) => a.trigger.toLowerCase() === trigger.toLowerCase());
              if (existing) existing.response = response;
              else list.push({ trigger, response });
              autoresponders.set(interaction.guild.id, list);
              saveAutoresponders();
              await interaction.reply({ content: `✅ تم حفظ الرد التلقائي بدون إمبيد للكلمة \`${trigger}\`.` });
        }
        else if (commandName === "replys") {
              if (!requireOwnerSlash(interaction)) return;
              const list = autoresponders.get(interaction.guild.id) || [];
              const text = list.length
                    ? list.map((a, i) => `**${i + 1}.** \`${a.trigger}\` ← ${a.response}`).join("\n")
                    : "لا توجد ردود تلقائية في هذا السيرفر.";
              await interaction.reply({ content: `**الردود التلقائية في ${interaction.guild.name}**\n${text}` });
        }

        // ── /setline و /line ──
        else if (commandName === "setline") {
              if (!requireOwnerSlash(interaction)) return;
              const image = interaction.options.getString("image").trim();
              if (!/^https?:\/\/\S+$/i.test(image)) {
                    return interaction.reply({ content: `❌ أرسل رابط صورة صحيح يبدأ بـ http أو https.`, flags: MessageFlags.Ephemeral });
              }
              lineDB.set(interaction.guild.id, image);
              saveLines();
              await interaction.reply({ content: `✅ تم حفظ صورة الخط بنجاح.` });
        }
        else if (commandName === "line") {
              if (!requirePermSlash(interaction, PermissionFlagsBits.ManageMessages)) return;
              const image = lineDB.get(interaction.guild.id);
              if (!image) return interaction.reply({ content: `❌ لم يتم تحديد صورة الخط بعد. استخدم \`/setline\` أولًا.`, flags: MessageFlags.Ephemeral });
              await interaction.reply({ content: image });
        }

        // ── /prison ──
        else if (commandName === "prison") {
              if (!requireOwnerOrAdminSlash(interaction)) return;
              const prisonChannelId = prisonCfg.get(interaction.guild.id);
              if (!prisonChannelId) return interaction.reply({ content: `❌ لم يتم تحديد روم السجن. استخدم: \`/setprison\``, flags: MessageFlags.Ephemeral });
              const target = await getTargetMember(interaction, "member");
              if (!target) return interaction.reply({ content: `❌ لم يتم العثور على هذا العضو بالسيرفر.`, flags: MessageFlags.Ephemeral });
              const prisonChannel = interaction.guild.channels.cache.get(prisonChannelId);
              if (!prisonChannel) return interaction.reply({ content: `❌ روم السجن غير موجود. أعد التحديد بـ \`/setprison\``, flags: MessageFlags.Ephemeral });
              const SUPP = [ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildAnnouncement, ChannelType.GuildStageVoice, ChannelType.GuildForum, ChannelType.GuildMedia];
              const channels = interaction.guild.channels.cache.filter((c) => SUPP.includes(c.type));
              for (const [, ch] of channels) {
                    if (!ch.permissionOverwrites) continue;
                    if (ch.id === prisonChannelId) {
                          await ch.permissionOverwrites.edit(target.id, { ViewChannel: true, SendMessages: true }).catch(() => {});
                    } else {
                          await ch.permissionOverwrites.edit(target.id, { ViewChannel: false }).catch(() => {});
                    }
              }
              await interaction.reply({ content: `🔒 **تم سجن ${target.user.username}** وتم توجيهه إلى ${prisonChannel}` });
              await sendModLog(interaction.guild, { action: "سجن (Prison)", moderator: interaction.user, target: target.user, reason: "تقييد الوصول من قبل الإدارة" });
              target.send({ content: `## 🔒 **تم سجنك في سيرفر ${interaction.guild.name}**\n\nلقد تم تقييد وصولك بواسطة الإدارة.\nتواصل مع الإدارة في روم السجن للاستفسار.` }).catch(() => {});
        }

        // ── /unprison ──
        else if (commandName === "unprison") {
              if (!requireOwnerOrAdminSlash(interaction)) return;
              const target = await getTargetMember(interaction, "member");
              if (!target) return interaction.reply({ content: `❌ لم يتم العثور على هذا العضو بالسيرفر.`, flags: MessageFlags.Ephemeral });
              const SUPP = [ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildAnnouncement, ChannelType.GuildStageVoice, ChannelType.GuildForum, ChannelType.GuildMedia];
              const channels = interaction.guild.channels.cache.filter((c) => SUPP.includes(c.type));
              for (const [, ch] of channels) {
                    if (!ch.permissionOverwrites) continue;
                    await ch.permissionOverwrites.delete(target.id).catch(() => {});
              }
              await interaction.reply({ content: `🔓 **تم الإفراج عن ${target.user.username}** واستعادة وصوله لجميع الرومات.` });
        }

        // ── /setprison ──
        else if (commandName === "setprison") {
              if (!requireOwnerOrAdminSlash(interaction)) return;
              const ch = interaction.options.getChannel("channel");
              prisonCfg.set(interaction.guild.id, ch.id);
              await interaction.reply({ content: `✅ **تم تحديد روم السجن إلى ${ch}**` });
        }

        // ── /rar ──
        else if (commandName === "rar") {
              if (!requireOwnerOrAdminSlash(interaction)) return;
              const target = await getTargetMember(interaction, "member");
              if (!target) return interaction.reply({ content: `❌ لم يتم العثور على هذا العضو بالسيرفر.`, flags: MessageFlags.Ephemeral });
              const roles = target.roles.cache.filter((r) => r.name !== "@everyone");
              if (roles.size === 0) return interaction.reply({ content: `❌ هذا العضو لا يمتلك أي رتب.`, flags: MessageFlags.Ephemeral });
              await target.roles.remove(roles).catch((e) => { throw new Error("فشل في إزالة الرتب. تأكد أن رتبة البوت أعلى."); });
              await interaction.reply({ content: `✅ **تم إزالة جميع رتب ${target.user.username} (${roles.size} رتبة)**` });
        }

        // ── /setavatar ──
        else if (commandName === "setavatar") {
              if (!requireOwnerOrAdminSlash(interaction)) return;
              const url = interaction.options.getString("url");
              await client.user.setAvatar(url).catch((e) => { throw new Error(`فشل تغيير الصورة: ${e.message}`); });
              await interaction.reply({ content: `✅ **تم تغيير صورة البوت بنجاح.**` });
        }

        // ── /setbanner ──
        else if (commandName === "setbanner") {
              if (!requireOwnerOrAdminSlash(interaction)) return;
              const url = interaction.options.getString("url");
              await client.user.setBanner(url).catch((e) => { throw new Error(`فشل تغيير البانر: ${e.message}`); });
              await interaction.reply({ content: `✅ **تم تغيير بانر البوت بنجاح.**` });
        }

        // ── /setbio ──
        else if (commandName === "setbio") {
              if (!requireOwnerOrAdminSlash(interaction)) return;
              const text = interaction.options.getString("text");
              client.user.setActivity(text, { type: 3 });
              await interaction.reply({ content: `✅ **تم تغيير نشاط البوت إلى:** \`${text}\`` });
        }

        // ── /setname ──
        else if (commandName === "setname") {
              if (!requireOwnerOrAdminSlash(interaction)) return;
              const name = interaction.options.getString("name");
              await client.user.setUsername(name).catch((e) => { throw new Error(`فشل تغيير الاسم: ${e.message}`); });
              await interaction.reply({ content: `✅ **تم تغيير اسم البوت إلى:** \`${name}\`` });
        }

        // ── /backupserver ──
        else if (commandName === "backupserver") {
              if (!requireOwnerOrAdminSlash(interaction)) return;
              await interaction.deferReply();
              const guild = interaction.guild;
              const backup = {
                    guildId: guild.id,
                    name: guild.name,
                    icon: guild.iconURL({ size: 1024 }),
                    banner: guild.bannerURL({ size: 1024 }),
                    verificationLevel: guild.verificationLevel,
                    afkTimeout: guild.afkTimeout,
                    afkChannelId: guild.afkChannelId,
                    systemChannelId: guild.systemChannelId,
                    takenAt: new Date().toISOString(),
                    roles: guild.roles.cache
                          .filter((r) => r.name !== "@everyone")
                          .sort((a, b) => b.position - a.position)
                          .map((r) => ({ id: r.id, name: r.name, color: r.hexColor, hoist: r.hoist, mentionable: r.mentionable, position: r.position, permissions: r.permissions.toArray() })),
                    channels: guild.channels.cache
                          .sort((a, b) => a.rawPosition - b.rawPosition)
                          .map((c) => ({ id: c.id, name: c.name, type: c.type, parentId: c.parentId, position: c.rawPosition, topic: c.topic || null })),
              };
              const buffer = Buffer.from(JSON.stringify(backup, null, 2), "utf8");
              await interaction.editReply({
                    content: `✅ **تم أخذ نسخة احتياطية كاملة من السيرفر (${backup.roles.length} رتبة، ${backup.channels.length} قناة).**`,
                    files: [new AttachmentBuilder(buffer, { name: `backup-${guild.id}.json` })],
              });
        }

        // ── /blacklist ──
        else if (commandName === "blacklist") {
              if (!requireOwnerOrAdminSlash(interaction)) return;
              const sub = interaction.options.getSubcommand();
              const member = await getTargetMember(interaction, "member");
              if (!member) return interaction.reply({ content: `❌ لم يتم العثور على هذا العضو بالسيرفر.`, flags: MessageFlags.Ephemeral });
              const gid = interaction.guild.id;
              const set = blacklistDB.get(gid) || new Set();
              if (sub === "add") {
                    if (member.id === OWNER_ID) return interaction.reply({ content: `❌ لا يمكن إضافة مالك البوت للقائمة السوداء.`, flags: MessageFlags.Ephemeral });
                    set.add(member.id);
                    blacklistDB.set(gid, set);
                    saveBlacklist();
                    await interaction.reply({ content: `✅ **تم منع ${member.user.username} من استخدام أوامر البوت نهائيًا.**` });
              } else if (sub === "remove") {
                    set.delete(member.id);
                    blacklistDB.set(gid, set);
                    saveBlacklist();
                    await interaction.reply({ content: `✅ **تم السماح لـ ${member.user.username} باستخدام أوامر البوت مجددًا.**` });
              }
        }

        // ── /maintenance ──
        else if (commandName === "maintenance") {
              if (!requireOwnerOrAdminSlash(interaction)) return;
              const state = interaction.options.getBoolean("state");
              maintenanceDB.set(interaction.guild.id, state);
              saveMaintenance();
              await interaction.reply({ content: state ? `🛠️ **تم تفعيل وضع الصيانة — تم تعطيل جميع الأوامر مؤقتًا لغير المالك/الأدمن.**` : `✅ **تم إلغاء وضع الصيانة — عادت الأوامر للعمل بشكل طبيعي.**` });
        }




        // ── /setwelcome ──
        else if (commandName === "setwelcome") {
              if (!requirePermSlash(interaction, PermissionFlagsBits.ManageGuild)) return;
              const ch = interaction.options.getChannel("channel");
              if (!greetCfg.has(interaction.guild.id)) greetCfg.set(interaction.guild.id, {});
              greetCfg.get(interaction.guild.id).welcomeChannel = ch.id;
              await interaction.reply({ content: `✅ **تم تعيين قناة الترحيب إلى ${ch}**` });
        }

        // ── /setleave ──
        else if (commandName === "setleave") {
              if (!requirePermSlash(interaction, PermissionFlagsBits.ManageGuild)) return;
              const ch = interaction.options.getChannel("channel");
              if (!greetCfg.has(interaction.guild.id)) greetCfg.set(interaction.guild.id, {});
              greetCfg.get(interaction.guild.id).leaveChannel = ch.id;
              await interaction.reply({ content: `✅ **تم تعيين قناة المغادرة إلى ${ch}**` });
        }

        // ── /welcomemsg ──
        else if (commandName === "welcomemsg") {
              if (!requirePermSlash(interaction, PermissionFlagsBits.ManageGuild)) return;
              const msg = interaction.options.getString("message");
              if (!greetCfg.has(interaction.guild.id)) greetCfg.set(interaction.guild.id, {});
              greetCfg.get(interaction.guild.id).welcomeMsg = msg;
              await interaction.reply({ content: `✅ **تم حفظ رسالة الترحيب.**` });
        }

        // ── /leavemsg ──
        else if (commandName === "leavemsg") {
              if (!requirePermSlash(interaction, PermissionFlagsBits.ManageGuild)) return;
              const msg = interaction.options.getString("message");
              if (!greetCfg.has(interaction.guild.id)) greetCfg.set(interaction.guild.id, {});
              greetCfg.get(interaction.guild.id).leaveMsg = msg;
              await interaction.reply({ content: `✅ **تم حفظ رسالة المغادرة.**` });
        }

        // ── /testwelcome ──
        else if (commandName === "testwelcome") {
              client.emit("guildMemberAdd", interaction.member);
              await interaction.reply({ content: `✅ **تم إرسال رسالة ترحيب تجريبية.**`, flags: MessageFlags.Ephemeral });
        }

        // ── /testleave ──
        else if (commandName === "testleave") {
              client.emit("guildMemberRemove", interaction.member);
              await interaction.reply({ content: `✅ **تم إرسال رسالة مغادرة تجريبية.**`, flags: MessageFlags.Ephemeral });
        }

        // ── /resetgreet ──
        else if (commandName === "resetgreet") {
              if (!requirePermSlash(interaction, PermissionFlagsBits.ManageGuild)) return;
              greetCfg.delete(interaction.guild.id);
              await interaction.reply({ content: `✅ **تم إعادة تعيين جميع إعدادات الترحيب.**` });
        }

  } catch (error) {
        console.error(`[SLASH ERROR] ${commandName}:`, error);
        const errMsg = { content: `❌ **حدث خطأ أثناء تنفيذ الأمر:**\n\`${error.message}\``, ephemeral: true };
        if (interaction.deferred || interaction.replied) {
              await interaction.followUp(errMsg).catch(() => {});
        } else {
              await interaction.reply(errMsg).catch(() => {});
        }
  }
}

client.on("interactionCreate", (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  handleSlashLikeCommand(interaction);
});

// ── دعم برفكس "-" للأوامر النصية (مطابق لخيارات السلاش) ──
const PREFIX = "-";

function findSlashCommandDef(name) {
  return slashCommands.find((c) => c.name === name);
}

function findAlias(guildId, name) {
  const aliases = aliasesDB.get(guildId) || [];
  return aliases.find((a) => a.alias.toLowerCase() === name.toLowerCase()) || null;
}

function resolveMemberArg(guild, token) {
  if (!guild || !token) return null;
  const id = (token.match(/^<@!?(\d+)>$/) || token.match(/^(\d{15,25})$/) || [])[1];
  if (id) return guild.members.cache.get(id) || null;
  const lower = token.toLowerCase();
  return guild.members.cache.find(
        (m) => m.user.username.toLowerCase() === lower || m.displayName.toLowerCase() === lower
  ) || null;
}
function resolveRoleArg(guild, token) {
  if (!guild || !token) return null;
  const id = (token.match(/^<@&(\d+)>$/) || token.match(/^(\d{15,25})$/) || [])[1];
  if (id) return guild.roles.cache.get(id) || null;
  const lower = token.toLowerCase();
  return guild.roles.cache.find((r) => r.name.toLowerCase() === lower) || null;
}
function resolveChannelArg(guild, token) {
  if (!guild || !token) return null;
  const id = (token.match(/^<#(\d+)>$/) || token.match(/^(\d{15,25})$/) || [])[1];
  if (id) return guild.channels.cache.get(id) || null;
  return guild.channels.cache.find((c) => c.name === token.replace(/^#/, "")) || null;
}

function getEffectiveOptionDefs(cmdDef, text) {
  const hasSub = (cmdDef.options || []).some((o) => o.type === 1 || o.type === 2);
  if (!hasSub) return { optionDefs: cmdDef.options || [], subcommand: null, rest: text };
  const trimmed = text.replace(/^\s+/, "");
  const subName = (trimmed.match(/^\S+/) || [])[0];
  const subDef = (cmdDef.options || []).find((o) => o.name === subName && (o.type === 1 || o.type === 2));
  if (!subDef) return { optionDefs: [], subcommand: null, rest: text, invalidSub: true };
  return { optionDefs: subDef.options || [], subcommand: subName, rest: trimmed.slice(subName.length) };
}

function parseOptionsFromText(optionDefs, text) {
  const values = {};
  let remaining = text;
  for (let i = 0; i < optionDefs.length; i++) {
        remaining = remaining.replace(/^\s+/, "");
        const def = optionDefs[i];
        const isLastString = i === optionDefs.length - 1 && def.type === 3;
        if (isLastString) {
              let val = remaining.trim();
              if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                    val = val.slice(1, -1);
              }
              values[def.name] = val || undefined;
              remaining = "";
        } else {
              const quoted = remaining.match(/^"([^"]*)"|^'([^']*)'/);
              let token;
              if (quoted) {
                    token = quoted[1] ?? quoted[2];
                    remaining = remaining.slice(quoted[0].length);
              } else {
                    token = (remaining.match(/^\S+/) || [""])[0];
                    remaining = remaining.slice(token.length);
              }
              values[def.name] = token || undefined;
        }
  }
  return values;
}

class MessageOptionsAdapter {
  constructor(guild, values, subcommand) {
        this._guild = guild;
        this._values = values;
        this._subcommand = subcommand || null;
  }
  getSubcommand() { return this._subcommand; }
  getString(name) { const v = this._values[name]; return v === undefined ? null : String(v); }
  getInteger(name) { const v = this._values[name]; if (v === undefined) return null; const n = parseInt(v, 10); return Number.isNaN(n) ? null : n; }
  getBoolean(name) { const v = this._values[name]; if (v === undefined) return null; return ["true", "1", "نعم", "yes"].includes(String(v).toLowerCase()); }
  getMember(name) { const v = this._values[name]; return v ? resolveMemberArg(this._guild, v) : null; }
  getUser(name) { const m = this.getMember(name); return m ? m.user : null; }
  getRole(name) { const v = this._values[name]; return v ? resolveRoleArg(this._guild, v) : null; }
  getChannel(name) { const v = this._values[name]; return v ? resolveChannelArg(this._guild, v) : null; }
}

client.on("messageCreate", async (message) => {
  try {
        if (!message.guild || message.author?.bot) return;
        if (!message.content?.startsWith(PREFIX)) return;
        const withoutPrefix = message.content.slice(PREFIX.length);
        const nameMatch = withoutPrefix.match(/^\S+/);
        if (!nameMatch) return;
         const typedName = nameMatch[0].toLowerCase();
         const alias = findAlias(message.guild.id, typedName.replace(/^-+/, ""));
         const commandName = alias?.command || (typedName === "خط" ? "line" : typedName);
        const cmdDef = findSlashCommandDef(commandName);
        if (!cmdDef) return;

        const { optionDefs, subcommand, rest, invalidSub } = getEffectiveOptionDefs(
              cmdDef,
              withoutPrefix.slice(nameMatch[0].length)
        );
        if (invalidSub) return void message.reply("❌ استخدام غير صحيح للأمر").catch(() => {});
        const values = parseOptionsFromText(optionDefs, rest);

        const adapter = {
              commandName,
              user: message.author,
              member: message.member,
              guild: message.guild,
              channel: message.channel,
              deferred: false,
              replied: false,
              options: new MessageOptionsAdapter(message.guild, values, subcommand),
              async reply(payload) {
                    const sent = await message.reply(typeof payload === "string" ? payload : payload);
                    this._replyMsg = sent;
                    this.replied = true;
                    return sent;
              },
              async deferReply() {
                    this._replyMsg = await message.channel.send("⏳");
                    this.deferred = true;
                    return this._replyMsg;
              },
              async editReply(payload) {
                    if (this._replyMsg) return this._replyMsg.edit(payload);
                    return this.reply(payload);
              },
              async followUp(payload) {
                    return message.channel.send(payload);
              },
        };

        await handleSlashLikeCommand(adapter);
  } catch (e) {
        console.error("[PREFIX CMD] خطأ:", e);
  }
});

// ── Welcome / Leave ──
client.on("guildMemberAdd", async (member) => {
  const { inviter, code } = await findUsedInvite(member.guild).catch(() => ({
        inviter: null,
        code: null,
  }));

  let inviterText;
  if (inviter) {
        inviterText = `<@${inviter.id}> \`${inviter.tag}\``;
  } else if (code) {
        inviterText = `عبر رابط الدعوة \`${code}\``;
  } else {
        inviterText = "تعذّر تحديد الداعي (دعوة فيستا أو صلاحية غير كافية)";
  }

  await sendLog(
        member.guild,
        "general",
        new EmbedV2Builder()
              .setTitle(`📥 عضو جديد انضم للسيرفر`)
              .addFields(
                    {
                          name: `👤 العضو`,
                          value: `<@${member.id}> \`${member.user.tag}\``,
                          inline: true,
                    },
                    { name: `🪪 الأيدي`, value: `\`${member.id}\``, inline: true },
                    {
                          name: `📨 دعاه`,
                          value: inviterText,
                          inline: false,
                    },
                    {
                          name: `📅 تاريخ إنشاء الحساب`,
                          value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:F>`,
                          inline: false,
                    },
                    {
                          name: `👥 إجمالي الأعضاء`,
                          value: `${member.guild.memberCount}`,
                          inline: true,
                    },
                    {
                          name: `👮 المسؤول عن العملية`,
                          value: inviter ? `<@${inviter.id}>` : "دعوة عامة / غير مباشرة",
                          inline: true,
                    },
                    {
                          name: `🕐 الوقت`,
                          value: `<t:${Math.floor(Date.now() / 1000)}:F>`,
                          inline: false,
                    }
              )
              .setThumbnail(member.user.displayAvatarURL({ extension: "png", size: 128 }))
              .setTimestamp()
  );

  const cfg = greetCfg.get(member.guild.id);
  if (!cfg) return;
  if (cfg.welcomeChannel) {
        const ch = member.guild.channels.cache.get(cfg.welcomeChannel);
        if (ch) {
              const text = (cfg.welcomeMsg || "مرحباً {user} في **{server}**! 🎉")
                    .replace("{user}", member.toString())
                    .replace("{server}", member.guild.name);
              const welcomeEmbed = new EmbedV2Builder()
                    .setTitle(`👋 عضو جديد انضم إلى السيرفر!`)
                    .setDescription(text)
                    .setThumbnail(member.user.displayAvatarURL({ extension: "png", size: 256 }))
                    .addFields(
                          { name: `👤 العضو`, value: `${member} \`${member.user.tag}\``, inline: true },
                          { name: `📨 دعاه`, value: inviterText, inline: true },
                          { name: `📅 تاريخ الانضمام`, value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false },
                          { name: `👥 إجمالي الأعضاء`, value: `${member.guild.memberCount}`, inline: true },
                    )
                    .setFooter({ text: `${member.guild.name}`, iconURL: member.guild.iconURL({ extension: "png" }) || undefined })
                    .setTimestamp();
              await ch.send(v2Payload(welcomeEmbed));
        }
  }
  if (cfg.welcomeRole) {
        const role = member.guild.roles.cache.get(cfg.welcomeRole);
        if (role) await member.roles.add(role).catch(() => {});
  }
});

client.on("guildMemberRemove", async (member) => {
  await sendLog(
        member.guild,
        "general",
        new EmbedV2Builder()
              .setTitle(`📤 عضو غادر السيرفر`)
              .addFields(
                    {
                          name: `👤 العضو`,
                          value: `<@${member.id}> \`${member.user.tag}\``,
                          inline: true,
                    },
                    { name: `🪪 الأيدي`, value: `\`${member.id}\``, inline: true },
                    {
                          name: `👥 إجمالي الأعضاء`,
                          value: `${member.guild.memberCount}`,
                          inline: true,
                    },
                    {
                          name: `🕐 الوقت`,
                          value: `<t:${Math.floor(Date.now() / 1000)}:F>`,
                          inline: false,
                    }
              )
              .setThumbnail(member.user.displayAvatarURL({ extension: "png", size: 128 }))
              .setTimestamp()
  );

  const cfg = greetCfg.get(member.guild.id);
  if (!cfg?.leaveChannel) return;
  const ch = member.guild.channels.cache.get(cfg.leaveChannel);
  if (!ch) return;
  const text = (cfg.leaveMsg || "وداعاً **{user}** 👋")
        .replace("{user}", member.user.username)
        .replace("{server}", member.guild.name);
  const leaveEmbed = new EmbedV2Builder()
        .setTitle(`🚪 عضو غادر السيرفر`)
        .setDescription(text)
        .setThumbnail(member.user.displayAvatarURL({ extension: "png", size: 256 }))
        .addFields(
              { name: `👤 العضو`, value: `${member.user.tag}`, inline: true },
              { name: `🪪 المنشن`, value: `<@${member.id}>`, inline: true },
              { name: `📅 تاريخ المغادرة`, value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false },
              { name: `👥 إجمالي الأعضاء`, value: `${member.guild.memberCount}`, inline: true },
        )
        .setFooter({ text: `${member.guild.name}`, iconURL: member.guild.iconURL({ extension: "png" }) || undefined })
        .setTimestamp();
  await ch.send(v2Payload(leaveEmbed));
});

// ── Voice Stats ──
client.on("voiceStateUpdate", (oldState, newState) => {
  const userId = newState.member?.id || oldState.member?.id;
  if (!userId) return;
  const guildId = newState.guild?.id || oldState.guild?.id;

  const vData = ensureVoiceStats(userId, guildId);

  if (!oldState.channelId && newState.channelId) {
        vData.joinedAt = Date.now();
  }

  if (oldState.channelId && !newState.channelId) {
        if (vData.joinedAt) {
              const minutesSpent = (Date.now() - vData.joinedAt) / 60000;
              vData.dayMinutes += minutesSpent;
              vData.weekMinutes += minutesSpent;
              vData.joinedAt = null;
        }
  }

  if (
        oldState.channelId &&
        newState.channelId &&
        oldState.channelId !== newState.channelId
  ) {
        if (vData.joinedAt) {
              const minutesSpent = (Date.now() - vData.joinedAt) / 60000;
              vData.dayMinutes += minutesSpent;
              vData.weekMinutes += minutesSpent;
        }
        vData.joinedAt = Date.now();
  }

  saveDB();
});

// ── LOG EVENTS ──

client.on("messageDelete", async (message) => {
  if (!message.guild || message.author?.bot) return;
  await sendLog(
        message.guild,
        "messages",
        new EmbedV2Builder()
              .setTitle(`🗑️ رسالة محذوفة`)
              .addFields(
                    {
                          name: `👤 العضو`,
                          value: message.author
                                ? `<@${message.author.id}> \`${message.author.tag}\``
                                : "مجهول",
                          inline: true,
                    },
                    {
                          name: `📌 القناة`,
                          value: `<#${message.channel.id}>`,
                          inline: true,
                    },
                    {
                          name: `🕐 الوقت`,
                          value: `<t:${Math.floor(Date.now() / 1000)}:F>`,
                          inline: false,
                    },
                    {
                          name: `📝 المحتوى`,
                          value: message.content
                                ? `\`\`\`${message.content.slice(0, 1000)}\`\`\``
                                : "*لا يوجد نص*",
                          inline: false,
                    }
              )
              .setTimestamp()
  );
});

client.on("messageUpdate", async (oldMsg, newMsg) => {
  if (!newMsg.guild || newMsg.author?.bot) return;
  if (oldMsg.content === newMsg.content) return;
  await sendLog(
        newMsg.guild,
        "messages",
        new EmbedV2Builder()
              .setTitle(`✏️ رسالة معدّلة`)
              .addFields(
                    {
                          name: `👤 العضو`,
                          value: `<@${newMsg.author.id}> \`${newMsg.author.tag}\``,
                          inline: true,
                    },
                    {
                          name: `📌 القناة`,
                          value: `<#${newMsg.channel.id}>`,
                          inline: true,
                    },
                    {
                          name: `📝 قبل التعديل`,
                          value: oldMsg.content
                                ? `\`\`\`${oldMsg.content.slice(0, 500)}\`\`\``
                                : "*فارغة*",
                          inline: false,
                    },
                    {
                          name: `✅ بعد التعديل`,
                          value: newMsg.content
                                ? `\`\`\`${newMsg.content.slice(0, 500)}\`\`\``
                                : "*فارغة*",
                          inline: false,
                    },
                    {
                          name: `🔗 الرابط`,
                          value: `[اذهب للرسالة](${newMsg.url})`,
                          inline: false,
                    }
              )
              .setTimestamp()
  );
});

client.on("voiceStateUpdate", async (oldState, newState) => {
  const member = newState.member || oldState.member;
  if (!member || member.user.bot) return;
  const guild = newState.guild || oldState.guild;

  if (!oldState.channelId && newState.channelId) {
        await sendLog(
              guild,
              "voice",
              new EmbedV2Builder()
                    .setTitle(`🟢 دخول روم صوتي`)
                    .addFields(
                          {
                                name: `👤 العضو`,
                                value: `<@${member.id}> \`${member.user.tag}\``,
                                inline: true,
                          },
                          {
                                name: `🎙️ الروم`,
                                value: `<#${newState.channelId}> \`${newState.channel?.name || ""}\``,
                                inline: true,
                          },
                          {
                                name: `🕐 الوقت`,
                                value: `<t:${Math.floor(Date.now() / 1000)}:F>`,
                                inline: false,
                          }
                    )
                    .setThumbnail(member.user.displayAvatarURL({ extension: "png", size: 64 }))
                    .setTimestamp()
        );
  }

  if (oldState.channelId && !newState.channelId) {
        await sendLog(
              guild,
              "voice",
              new EmbedV2Builder()
                    .setTitle(`🔴 خروج من روم صوتي`)
                    .addFields(
                          {
                                name: `👤 العضو`,
                                value: `<@${member.id}> \`${member.user.tag}\``,
                                inline: true,
                          },
                          {
                                name: `🎙️ الروم`,
                                value: `<#${oldState.channelId}> \`${oldState.channel?.name || ""}\``,
                                inline: true,
                          },
                          {
                                name: `🕐 الوقت`,
                                value: `<t:${Math.floor(Date.now() / 1000)}:F>`,
                                inline: false,
                          }
                    )
                    .setThumbnail(member.user.displayAvatarURL({ extension: "png", size: 64 }))
                    .setTimestamp()
        );
  }

  if (
        oldState.channelId &&
        newState.channelId &&
        oldState.channelId !== newState.channelId
  ) {
        await sendLog(
              guild,
              "voice",
              new EmbedV2Builder()
                    .setTitle(`🔀 انتقل بين الرومات الصوتية`)
                    .addFields(
                          {
                                name: `👤 العضو`,
                                value: `<@${member.id}> \`${member.user.tag}\``,
                                inline: false,
                          },
                          {
                                name: `📤 من`,
                                value: `<#${oldState.channelId}> \`${oldState.channel?.name || ""}\``,
                                inline: true,
                          },
                          {
                                name: `📥 إلى`,
                                value: `<#${newState.channelId}> \`${newState.channel?.name || ""}\``,
                                inline: true,
                          },
                          {
                                name: `🕐 الوقت`,
                                value: `<t:${Math.floor(Date.now() / 1000)}:F>`,
                                inline: false,
                          }
                    )
                    .setThumbnail(member.user.displayAvatarURL({ extension: "png", size: 64 }))
                    .setTimestamp()
        );
  }
});

function executorField(executor) {
  return {
        name: `👮 المسؤول عن العملية`,
        value: executor ? `<@${executor.id}> \`${executor.tag}\`` : "غير معروف (تعذّر تحديده من سجل التدقيق)",
        inline: true,
  };
}

client.on("channelCreate", async (channel) => {
  if (!channel.guild) return;
  const executor = await getAuditExecutor(channel.guild, AuditLogEvent.ChannelCreate, channel.id);
  await sendLog(
        channel.guild,
        "channels",
        new EmbedV2Builder()
              .setTitle(`📂 روم جديد تم إنشاؤه`)
              .addFields(
                    {
                          name: `📌 الاسم`,
                          value: `<#${channel.id}> \`${channel.name}\``,
                          inline: true,
                    },
                    {
                          name: `📋 النوع`,
                          value:
                                channel.type === 2
                                      ? "🎙️ صوتي"
                                      : channel.type === 4
                                      ? "📁 كاتيقوري"
                                      : "💬 كتابي",
                          inline: true,
                    },
                    executorField(executor),
                    {
                          name: `🕐 الوقت`,
                          value: `<t:${Math.floor(Date.now() / 1000)}:F>`,
                          inline: false,
                    }
              )
              .setTimestamp()
  );
});

client.on("channelDelete", async (channel) => {
  if (!channel.guild) return;
  const executor = await getAuditExecutor(channel.guild, AuditLogEvent.ChannelDelete, channel.id);
  await sendLog(
        channel.guild,
        "channels",
        new EmbedV2Builder()
              .setTitle(`🗑️ روم تم حذفه`)
              .addFields(
                    { name: `📌 الاسم`, value: `\`${channel.name}\``, inline: true },
                    {
                          name: `📋 النوع`,
                          value: channel.type === 2 ? "🎙️ صوتي" : "💬 نصي",
                          inline: true,
                    },
                    executorField(executor),
                    {
                          name: `🕐 الوقت`,
                          value: `<t:${Math.floor(Date.now() / 1000)}:F>`,
                          inline: false,
                    }
              )
              .setTimestamp()
  );
});

client.on("channelUpdate", async (oldChannel, newChannel) => {
  if (!newChannel.guild) return;
  const changes = [];
  if (oldChannel.name !== newChannel.name)
        changes.push({
              name: `✏️ تغيير الاسم`,
              value: `\`${oldChannel.name}\` ← \`${newChannel.name}\``,
              inline: false,
        });
  if (oldChannel.topic !== newChannel.topic)
        changes.push({
              name: `📝 تغيير الوصف`,
              value: `قبل: ${oldChannel.topic || "*فارغ*"}\nبعد: ${newChannel.topic || "*فارغ*"}`,
              inline: false,
        });
  if (changes.length === 0) return;
  const executor = await getAuditExecutor(newChannel.guild, AuditLogEvent.ChannelUpdate, newChannel.id);
  await sendLog(
        newChannel.guild,
        "channels",
        new EmbedV2Builder()
              .setTitle(`⚙️ تعديل روم`)
              .addFields(
                    {
                          name: `📌 الروم`,
                          value: `<#${newChannel.id}> \`${newChannel.name}\``,
                          inline: false,
                    },
                    executorField(executor),
                    {
                          name: `🕐 الوقت`,
                          value: `<t:${Math.floor(Date.now() / 1000)}:F>`,
                          inline: false,
                    },
                    ...changes
              )
              .setTimestamp()
  );
});

client.on("roleCreate", async (role) => {
  const executor = await getAuditExecutor(role.guild, AuditLogEvent.RoleCreate, role.id);
  await sendLog(
        role.guild,
        "general",
        new EmbedV2Builder()
              .setTitle(`✨ رتبة جديدة تم إنشاؤها`)
              .addFields(
                    {
                          name: ` : الرتبة`,
                          value: `<@&${role.id}> \`${role.name}\``,
                          inline: true,
                    },
                    { name: `:  اللون`, value: role.hexColor, inline: true },
                    executorField(executor),
                    {
                          name: `: الوقت`,
                          value: `<t:${Math.floor(Date.now() / 1000)}:F>`,
                          inline: false,
                    }
              )
              .setTimestamp()
  );
});

client.on("guildMemberUpdate", async (oldMember, newMember) => {
  const addedRoles = newMember.roles.cache.filter(
        (r) => !oldMember.roles.cache.has(r.id)
  );
  const removedRoles = oldMember.roles.cache.filter(
        (r) => !newMember.roles.cache.has(r.id)
  );
  if (addedRoles.size > 0) {
        const executor = await getAuditExecutor(newMember.guild, AuditLogEvent.MemberRoleUpdate, newMember.id);
        await sendLog(
              newMember.guild,
              "general",
              new EmbedV2Builder()
                    .setTitle(`: رتبة أُعطيت لعضو`)
                    .addFields(
                          {
                                name: `👤 العضو`,
                                value: `<@${newMember.id}> \`${newMember.user.tag}\``,
                                inline: true,
                          },
                          {
                                name: `: الرتب المضافة`,
                                value: addedRoles.map((r) => `<@&${r.id}>`).join(", "),
                                inline: true,
                          },
                          executorField(executor),
                          {
                                name: `: الوقت`,
                                value: `<t:${Math.floor(Date.now() / 1000)}:F>`,
                                inline: false,
                          }
                    )
                    .setThumbnail(newMember.user.displayAvatarURL({ extension: "png", size: 64 }))
                    .setTimestamp()
        );
  }
  if (removedRoles.size > 0) {
        const executor = await getAuditExecutor(newMember.guild, AuditLogEvent.MemberRoleUpdate, newMember.id);
        await sendLog(
              newMember.guild,
              "general",
              new EmbedV2Builder()
                    .setTitle(`➖ رتبة سُحبت من عضو`)
                    .addFields(
                          {
                                name: `: العضو`,
                                value: `<@${newMember.id}> \`${newMember.user.tag}\``,
                                inline: true,
                          },
                          {
                                name: `: الرتب المسحوبة`,
                                value: removedRoles.map((r) => `<@&${r.id}>`).join(", "),
                                inline: true,
                          },
                          executorField(executor),
                          {
                                name: `: الوقت`,
                                value: `<t:${Math.floor(Date.now() / 1000)}:F>`,
                                inline: false,
                          }
                    )
                    .setThumbnail(newMember.user.displayAvatarURL({ extension: "png", size: 64 }))
                    .setTimestamp()
        );
  }
});

//  MESSAGE COMMANDS
const ARABIC_SHORTCUTS = [
  "طرد", "لف", "تايم", "انتايم", "نك", "قفل", "فتح", "رول", "تحذير",
  "u", "s", "t",
  "صورة", "برا", "شيل", "تحذيرات", "مسح", "ايدي",
  "سجن", "اخراج", "فك",
  "افك", "سنايب", "تحذيرات", "المحذرين", "نقل",
];

//  Snipe — حفظ آخر رسالة محذوفة
client.on("messageDelete", (message) => {
  if (message.author?.bot) return;
  if (!message.content && message.attachments.size === 0) return;
  const imageURL = message.attachments.find((a) => a.contentType?.startsWith("image/"))?.url || null;
  snipeMap.set(message.channel.id, {
        content: message.content || "",
        authorTag: message.author?.tag || "Unknown#0000",
        authorAvatar: message.author?.displayAvatarURL({ extension: "png", size: 128 }) || null,
        timestamp: Date.now(),
        imageURL,
  });
});

client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild) return;

  const clean = message.content
        .replace(/[\u200f\u200e\u200b\u00a0\u202a-\u202e\u2066-\u2069\uFEFF]/g, "")
        .trim();

  // ── AFK — رد تلقائي على منشن أعضاء AFK ──
  if (message.mentions.users.size > 0) {
        for (const [, user] of message.mentions.users) {
              const afkKey = `${message.guild.id}:${user.id}`;
              const afkData = afkMap.get(afkKey);
              if (afkData) {
                    const elapsed = Math.floor((Date.now() - afkData.timestamp) / 60000);
                    const timeText = elapsed < 1 ? "just now" : elapsed === 1 ? "1 minute ago" : `${elapsed} minutes ago`;
                    const container = new ContainerBuilder().setAccentColor(0x5865F2);
                    container.addSectionComponents(
                          new SectionBuilder()
                                .addTextDisplayComponents(
                                      new TextDisplayBuilder().setContent(
                                            `💤 **${user.username}** is currently AFK\n> **Reason** \`\`${afkData.reason}\`\`\n> *Away for ${timeText}*`
                                      )
                                )
                                .setThumbnailAccessory(
                                      new ThumbnailBuilder().setURL(user.displayAvatarURL({ extension: "png", size: 128 }))
                                )
                    );
                    await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
                    
                    // إضافة المنشن إلى قائمة الأشخاص الذين منشنوا صاحب AFK
                    if (!afkData.mentions.find(m => m.userId === message.author.id)) {
                          afkData.mentions.push({
                                userId: message.author.id,
                                username: message.author.username,
                                timestamp: Date.now()
                          });
                    }
              }
        }
  }

  // ── إزالة AFK عند إرسال رسالة ──
  const selfAfkKey = `${message.guild.id}:${message.author.id}`;
  if (afkMap.has(selfAfkKey)) {
        const afkData = afkMap.get(selfAfkKey);
        afkMap.delete(selfAfkKey);
        
        // حساب وقت AFK بالساعات والدقائق والثواني والمللي ثانية
        const afkDuration = Date.now() - afkData.timestamp;
        const hours = Math.floor(afkDuration / 3600000);
        const minutes = Math.floor((afkDuration % 3600000) / 60000);
        const seconds = Math.floor((afkDuration % 60000) / 1000);
        const milliseconds = Math.floor((afkDuration % 1000) / 10);
        
        const timeFormat = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}:${String(milliseconds).padStart(2, '0')}`;
        
        // بناء قائمة المنشنات
        let mentionsList = "لا احد منشنك او وردعليك";
        if (afkData.mentions && afkData.mentions.length > 0) {
              mentionsList = afkData.mentions
                    .map(m => `<@${m.userId}>`)
                    .join("\n");
        }
        
        const AFK_EMOJI = "<:afk:1537214034158420029>";
        const embed = new EmbedV2Builder()
              .setColor(0x9C27B0)
              .setDescription(
                    `${AFK_EMOJI} **تم إزاله حالة afk لديك!**\n\n` +
                    `**لقد جلست في وضع ${timeFormat} afk !!**\n\n` +
                    `**لقد تلقيت رسائل من :**\n${mentionsList}`
              );
        
        await message.reply(v2Payload(embed)).catch(() => null);
  }

  // ── الرد التلقائي ──
  const arList = autoresponders.get(message.guild.id);
  if (arList && arList.length) {
        const lowerContent = clean.toLowerCase();
        const match = arList.find((a) => lowerContent.includes(a.trigger.toLowerCase()));
        if (match) {
              await message.reply({ content: match.response }).catch(() => {});
        }
  }

  // ── إحصائيات الرسائل ──
  const mStat = ensureMsgStats(message.author.id, message.guild.id);
  mStat.todayCount++;
  mStat.weekCount++;
});

// ══════════════════════════════════════════════════════
//  Reaction Role — رتبة "REALM"
// ══════════════════════════════════════════════════════
const REALM_ROLE_MESSAGE_ID = "1485691517510221825";
const REALM_ROLE_CHANNEL_ID = "1485674811815497871";
const REALM_ROLE_GUILD_ID = "817668410250362901";
const REALM_ROLE_ID = "1522604104684277851";
const REALM_ROLE_EMOJI_ID = "1485674285912559646";

client.on("messageReactionAdd", async (reaction, user) => {
  try {
        if (user.bot) return;
        if (reaction.message.id !== REALM_ROLE_MESSAGE_ID) return;
        if (reaction.emoji.id !== REALM_ROLE_EMOJI_ID) return;

        if (reaction.partial) await reaction.fetch().catch(() => {});
        if (reaction.message.partial) await reaction.message.fetch().catch(() => {});

        const guild = client.guilds.cache.get(REALM_ROLE_GUILD_ID);
        if (!guild) return;

        const member = await guild.members.fetch(user.id).catch(() => null);
        if (!member) return;

        await member.roles.add(REALM_ROLE_ID).catch((e) => {
              console.error("[REALM ROLE] فشل إضافة الرتبة:", e.message);
        });
  } catch (e) {
        console.error("[REALM ROLE] خطأ:", e);
  }
});

client.on("messageReactionRemove", async (reaction, user) => {
  try {
        if (user.bot) return;
        if (reaction.message.id !== REALM_ROLE_MESSAGE_ID) return;
        if (reaction.emoji.id !== REALM_ROLE_EMOJI_ID) return;

        if (reaction.partial) await reaction.fetch().catch(() => {});

        const guild = client.guilds.cache.get(REALM_ROLE_GUILD_ID);
        if (!guild) return;

        const member = await guild.members.fetch(user.id).catch(() => null);
        if (!member) return;

        await member.roles.remove(REALM_ROLE_ID).catch((e) => {
              console.error("[REALM ROLE] فشل إزالة الرتبة:", e.message);
        });
  } catch (e) {
        console.error("[REALM ROLE] خطأ:", e);
  }
});

process.on("SIGINT", () => {
  saveDB();
  process.exit(0);
});
process.on("SIGTERM", () => {
  saveDB();
  process.exit(0);
});

client.login(config.token);