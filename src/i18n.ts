type Locale = "en" | "zh" | "ja";
type LocaleSource = { from?: { language_code?: string } };

export const translations = {
	en: {
		blocked: "You cannot send messages.", captcha: "What is {left} + {right}?", tguard: "Open verification: {url}", saved: "Saved.", incorrect: "Incorrect.", notYourChallenge: "This is not your challenge.",
		welcome: "Tell me what you want to forward.", threadDeleted: "Thread deleted.", globalPermissionSaved: "Global permission saved.", userPermissionSaved: "User permission saved.", userBlocked: "User blocked.", userVerified: "User verified.", noteSaved: "Note saved.", noteValue: "Note: {note}", noNote: "No note.",
		permissionUsage: "Usage: /permission <key|all> <allow|deny>", userPermissionUsage: "Usage: /{command} <key|all>", unknownPermission: "Unknown permission keys: {keys}.", restricted: "You cannot send {permissions} messages.",
		runAdminMain: "Run /admin in the main chat of the forwarding forum group.", topicsRequired: "This group must have Topics enabled.", botTopicsRequired: "Make the bot an administrator with Manage Topics permission, then run /admin again.", groupConfigured: "A forwarding group is already configured.", groupInitialized: "Forwarding group initialized.", adminSettings: "Admin settings", welcomeMessage: "Welcome message", captchaSetting: "Captcha", cancel: "Cancel", cancelled: "Cancelled.", sendValue: "Send the value, or /cancel.",
		autoReplies: "Auto replies", spamKeywords: "Spam keywords", add: "Add", list: "List", sendTrigger: "Send the trigger text, or /cancel.", invalidTrigger: "Send non-empty text up to 256 characters.", invalidRegex: "The regular expression is invalid.", chooseTrigger: "Choose literal text or regex.", literal: "Literal", regex: "Regex", sendResponse: "Send response text up to 4096 characters or supported media, or /cancel.", unsupportedResponse: "Send text, photo, sticker, video, document, audio, voice, or animation.", chooseWindow: "Choose an active time window.", allDay: "All day", customWindow: "Set window", sendStart: "Send the start time as HH:MM.", sendEnd: "Send the end time as HH:MM.", sendTimeZone: "Send an IANA time zone, for example Asia/Shanghai.", invalidTime: "Use a valid HH:MM time.", invalidTimeZone: "Use a valid IANA time zone.", autoReplySaved: "Auto reply saved.", noAutoReplies: "No auto replies.", enabled: "Enabled", disabled: "Disabled", toggle: "Toggle", delete: "Delete", autoReplyDeleted: "Auto reply deleted.", sendKeyword: "Send the spam keyword, or /cancel.", invalidKeyword: "Send a non-empty keyword up to 128 characters.", spamKeywordSaved: "Spam keyword saved.", noSpamKeywords: "No spam keywords.", spamKeywordDeleted: "Spam keyword deleted.",
		photo: "photo", sticker: "sticker or animation", video: "video", voice: "voice", file: "file", link: "link", username: "username",
	},
	zh: {
		blocked: "你暂时不能发送消息。", captcha: "请计算 {left} + {right}。", tguard: "请打开验证链接：{url}", saved: "已保存。", incorrect: "答案不正确。", notYourChallenge: "这不是你的验证题。",
		welcome: "请告诉我你想转发什么。", threadDeleted: "话题已删除。", globalPermissionSaved: "全局权限已保存。", userPermissionSaved: "用户权限已保存。", userBlocked: "用户已封禁。", userVerified: "用户已验证。", noteSaved: "备注已保存。", noteValue: "备注：{note}", noNote: "没有备注。",
		permissionUsage: "用法：/permission <key|all> <allow|deny>", userPermissionUsage: "用法：/{command} <key|all>", unknownPermission: "未知权限键：{keys}。", restricted: "你不能发送{permissions}消息。",
		runAdminMain: "请在转发论坛群的主聊天中运行 /admin。", topicsRequired: "此群组必须启用话题。", botTopicsRequired: "请将机器人设为拥有管理话题权限的管理员，然后再次运行 /admin。", groupConfigured: "已配置转发群。", groupInitialized: "转发群已初始化。", adminSettings: "管理员设置", welcomeMessage: "欢迎消息", captchaSetting: "验证码", cancel: "取消", cancelled: "已取消。", sendValue: "请发送值，或使用 /cancel。",
		autoReplies: "自动回复", spamKeywords: "垃圾关键词", add: "添加", list: "查看", sendTrigger: "请发送触发文本，或使用 /cancel。", invalidTrigger: "请发送不超过 256 个字符的非空文本。", invalidRegex: "正则表达式无效。", chooseTrigger: "请选择普通文本或正则表达式。", literal: "普通文本", regex: "正则表达式", sendResponse: "请发送不超过 4096 个字符的回复文本或支持的媒体，或使用 /cancel。", unsupportedResponse: "请发送文本、图片、贴纸、视频、文件、音频、语音或动画。", chooseWindow: "请选择生效时间段。", allDay: "全天", customWindow: "设置时间段", sendStart: "请以 HH:MM 发送开始时间。", sendEnd: "请以 HH:MM 发送结束时间。", sendTimeZone: "请发送 IANA 时区，例如 Asia/Shanghai。", invalidTime: "请使用有效的 HH:MM 时间。", invalidTimeZone: "请使用有效的 IANA 时区。", autoReplySaved: "自动回复已保存。", noAutoReplies: "没有自动回复。", enabled: "已启用", disabled: "已停用", toggle: "切换", delete: "删除", autoReplyDeleted: "自动回复已删除。", sendKeyword: "请发送垃圾关键词，或使用 /cancel。", invalidKeyword: "请发送不超过 128 个字符的非空关键词。", spamKeywordSaved: "垃圾关键词已保存。", noSpamKeywords: "没有垃圾关键词。", spamKeywordDeleted: "垃圾关键词已删除。",
		photo: "图片", sticker: "贴纸或动画", video: "视频", voice: "语音", file: "文件", link: "链接", username: "用户名",
	},
	ja: {
		blocked: "メッセージを送信できません。", captcha: "{left} + {right} は？", tguard: "認証リンクを開いてください: {url}", saved: "保存しました。", incorrect: "正しくありません。", notYourChallenge: "あなたの認証ではありません。",
		welcome: "転送したい内容を送ってください。", threadDeleted: "トピックを削除しました。", globalPermissionSaved: "グローバル権限を保存しました。", userPermissionSaved: "ユーザー権限を保存しました。", userBlocked: "ユーザーをブロックしました。", userVerified: "ユーザーを認証しました。", noteSaved: "メモを保存しました。", noteValue: "メモ: {note}", noNote: "メモはありません。",
		permissionUsage: "使い方: /permission <key|all> <allow|deny>", userPermissionUsage: "使い方: /{command} <key|all>", unknownPermission: "不明な権限キー: {keys}。", restricted: "{permissions}メッセージは送信できません。",
		runAdminMain: "転送先フォーラムグループのメインチャットで /admin を実行してください。", topicsRequired: "このグループではトピックを有効にする必要があります。", botTopicsRequired: "ボットをトピック管理権限のある管理者にしてから、/admin を再実行してください。", groupConfigured: "転送先グループはすでに設定されています。", groupInitialized: "転送先グループを初期化しました。", adminSettings: "管理者設定", welcomeMessage: "歓迎メッセージ", captchaSetting: "認証", cancel: "キャンセル", cancelled: "キャンセルしました。", sendValue: "値を送信するか、/cancel を使ってください。",
		autoReplies: "自動返信", spamKeywords: "スパムキーワード", add: "追加", list: "一覧", sendTrigger: "トリガー文字列を送信するか、/cancel を使ってください。", invalidTrigger: "256 文字以内の空でないテキストを送信してください。", invalidRegex: "正規表現が無効です。", chooseTrigger: "通常の文字列か正規表現かを選択してください。", literal: "通常文字列", regex: "正規表現", sendResponse: "4096 文字以内の返信テキストまたは対応メディアを送信するか、/cancel を使ってください。", unsupportedResponse: "テキスト、写真、スタンプ、動画、ファイル、音声、ボイス、アニメーションを送信してください。", chooseWindow: "有効な時間帯を選択してください。", allDay: "終日", customWindow: "時間帯を設定", sendStart: "開始時刻を HH:MM で送信してください。", sendEnd: "終了時刻を HH:MM で送信してください。", sendTimeZone: "Asia/Tokyo のような IANA タイムゾーンを送信してください。", invalidTime: "有効な HH:MM 時刻を使ってください。", invalidTimeZone: "有効な IANA タイムゾーンを使ってください。", autoReplySaved: "自動返信を保存しました。", noAutoReplies: "自動返信はありません。", enabled: "有効", disabled: "無効", toggle: "切替", delete: "削除", autoReplyDeleted: "自動返信を削除しました。", sendKeyword: "スパムキーワードを送信するか、/cancel を使ってください。", invalidKeyword: "128 文字以内の空でないキーワードを送信してください。", spamKeywordSaved: "スパムキーワードを保存しました。", noSpamKeywords: "スパムキーワードはありません。", spamKeywordDeleted: "スパムキーワードを削除しました。",
		photo: "写真", sticker: "スタンプまたはアニメーション", video: "動画", voice: "音声", file: "ファイル", link: "リンク", username: "ユーザー名",
	},
} as const;

export type TranslationKey = keyof typeof translations.en;

export function locale(source: LocaleSource): Locale {
	const language = source.from?.language_code?.toLowerCase() ?? "";
	return language.startsWith("zh") ? "zh" : language.startsWith("ja") ? "ja" : "en";
}

export function t(source: LocaleSource, key: TranslationKey, values: Record<string, string | number> = {}) {
	return translations[locale(source)][key].replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? `{${name}}`));
}

export function missingTranslationKeys() {
	return (Object.keys(translations.en) as TranslationKey[]).flatMap((key) => (Object.keys(translations).filter((language) => !(key in translations[language as Locale]))));
}
