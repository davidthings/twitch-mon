const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '..', 'tokens.json');

function readStore() {
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeStore(data) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
}

function getTokens() {
  return readStore();
}

function saveTokens(tokens) {
  writeStore(tokens);
}

function setTokensForUser(userId, tokenObj) {
  const data = readStore();
  data[userId] = tokenObj;
  writeStore(data);
}

function getTokensForUser(userId) {
  const data = readStore();
  return data[userId] || null;
}

function listUserIds() {
  const data = readStore();
  return Object.keys(data);
}

module.exports = {
  getTokens,
  saveTokens,
  setTokensForUser,
  getTokensForUser,
  listUserIds,
};
