const SHEET_NAME = "messages";
const DRIVE_FOLDER_PROPERTY = "DRIVE_FOLDER_ID";
const SECRET_PROPERTY = "APP_SECRET";
const HEADERS = [
  "id",
  "roomId",
  "senderRole",
  "senderId",
  "type",
  "text",
  "imageUrl",
  "imageFileId",
  "createdAt",
  "clientTimestamp",
];

function doGet(e) {
  return withJsonOutput(function () {
    const roomId = getParam(e, "roomId");
    const since = getParam(e, "since");
    const secret = getParam(e, "secret");

    validateSecret(secret);
    requireValue(roomId, "roomId is required");

    const messages = readMessages(roomId, since);
    return { ok: true, messages: messages };
  });
}

function doPost(e) {
  return withJsonOutput(function () {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error("Request body is required");
    }

    const payload = JSON.parse(e.postData.contents);
    validateSecret(payload.secret);
    requireValue(payload.roomId, "roomId is required");

    if (payload.action === "delete") {
      requireValue(payload.messageId, "messageId is required");
      deleteMessage(payload.roomId, payload.messageId);
      return { ok: true };
    }

    requireValue(payload.senderRole, "senderRole is required");
    requireValue(payload.type, "type is required");

    const message = createMessage(payload);
    return { ok: true, message: message };
  });
}

function withJsonOutput(handler) {
  try {
    const result = handler();
    return jsonOutput(result);
  } catch (error) {
    return jsonOutput({
      ok: false,
      error: error && error.message ? error.message : "Unexpected error",
    });
  }
}

function jsonOutput(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function getParam(event, key) {
  if (!event || !event.parameter) {
    return "";
  }
  return String(event.parameter[key] || "").trim();
}

function validateSecret(secret) {
  const storedSecret = PropertiesService.getScriptProperties().getProperty(SECRET_PROPERTY);
  if (!storedSecret) {
    throw new Error("APP_SECRET is not configured");
  }
  if (secret !== storedSecret) {
    throw new Error("Unauthorized");
  }
}

function requireValue(value, message) {
  if (!value) {
    throw new Error(message);
  }
}

function createMessage(payload) {
  const sheet = getOrCreateSheet();
  const columns = getColumnMap(sheet);
  const createdAt = new Date().toISOString();
  const messageId = Utilities.getUuid();
  const text = String(payload.text || "").trim();
  const senderId = String(payload.senderId || "");
  let image = { url: "", fileId: "" };

  requireValue(senderId, "senderId is required");

  if (payload.type === "text") {
    requireValue(text, "text is required for text messages");
  } else if (payload.type === "image") {
    requireValue(payload.imageData, "imageData is required for image messages");
    image = saveImage(payload.imageData, payload.fileName, payload.mimeType, payload.roomId);
  } else {
    throw new Error("Unsupported type");
  }

  const row = buildRow(columns, {
    id: messageId,
    roomId: String(payload.roomId),
    senderRole: String(payload.senderRole),
    senderId: senderId,
    type: String(payload.type),
    text: text,
    imageUrl: image.url,
    imageFileId: image.fileId,
    createdAt: createdAt,
    clientTimestamp: String(payload.clientTimestamp || ""),
  });

  sheet.appendRow(row);

  return {
    id: messageId,
    roomId: String(payload.roomId),
    senderRole: String(payload.senderRole),
    senderId: senderId,
    type: String(payload.type),
    text: text,
    imageUrl: image.url,
    createdAt: createdAt,
  };
}

function deleteMessage(roomId, messageId) {
  const sheet = getOrCreateSheet();
  const columns = getColumnMap(sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    throw new Error("Message not found");
  }

  const values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  for (var index = values.length - 1; index >= 0; index -= 1) {
    const row = values[index];
    if (
      String(row[columns.id] || "") === String(messageId) &&
      String(row[columns.roomId] || "") === String(roomId)
    ) {
      const imageFileId = String(row[columns.imageFileId] || "");
      if (imageFileId) {
        deleteImageFile(imageFileId);
      }
      sheet.deleteRow(index + 2);
      return;
    }
  }

  throw new Error("Message not found");
}

function readMessages(roomId, since) {
  const sheet = getOrCreateSheet();
  const columns = getColumnMap(sheet);
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) {
    return [];
  }

  const sinceTime = since ? new Date(since).getTime() : 0;
  return values
    .slice(1)
    .map(function (row) {
      return {
        id: String(row[columns.id] || ""),
        roomId: String(row[columns.roomId] || ""),
        senderRole: String(row[columns.senderRole] || ""),
        senderId: String(row[columns.senderId] || ""),
        type: String(row[columns.type] || "text"),
        text: String(row[columns.text] || ""),
        imageUrl: String(row[columns.imageUrl] || ""),
        createdAt: String(row[columns.createdAt] || ""),
      };
    })
    .filter(function (message) {
      if (message.roomId !== roomId) {
        return false;
      }
      if (!sinceTime) {
        return true;
      }
      return new Date(message.createdAt).getTime() > sinceTime;
    })
    .sort(function (left, right) {
      return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    });
}

function getOrCreateSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(SHEET_NAME);
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    return sheet;
  }

  ensureHeaders(sheet);
  return sheet;
}

function ensureHeaders(sheet) {
  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  const existingHeaders = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  const normalizedHeaders = existingHeaders.map(function (header) {
    return String(header || "");
  });

  HEADERS.forEach(function (header) {
    if (normalizedHeaders.indexOf(header) === -1) {
      sheet.getRange(1, normalizedHeaders.length + 1).setValue(header);
      normalizedHeaders.push(header);
    }
  });
}

function getColumnMap(sheet) {
  ensureHeaders(sheet);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const map = {};

  HEADERS.forEach(function (header, index) {
    const actualIndex = headers.indexOf(header);
    map[header] = actualIndex >= 0 ? actualIndex : index;
  });

  return map;
}

function buildRow(columns, values) {
  const size = Math.max.apply(
    null,
    HEADERS.map(function (header) {
      return columns[header];
    })
  ) + 1;
  const row = new Array(size).fill("");

  HEADERS.forEach(function (header) {
    row[columns[header]] = values[header] || "";
  });

  return row;
}

function saveImage(imageData, fileName, mimeType, roomId) {
  const folderId = PropertiesService.getScriptProperties().getProperty(DRIVE_FOLDER_PROPERTY);
  if (!folderId) {
    throw new Error("DRIVE_FOLDER_ID is not configured");
  }

  const folder = DriveApp.getFolderById(folderId);
  const cleanedFileName = fileName || "image.jpg";
  const parts = String(imageData || "").split(",");
  if (parts.length < 2) {
    throw new Error("Invalid imageData");
  }

  const bytes = Utilities.base64Decode(parts[1]);
  const blob = Utilities.newBlob(bytes, mimeType || "image/jpeg", roomId + "-" + cleanedFileName);
  const file = folder.createFile(blob);

  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return {
    url: "https://drive.google.com/uc?export=view&id=" + file.getId(),
    fileId: file.getId(),
  };
}

function deleteImageFile(fileId) {
  try {
    DriveApp.getFileById(fileId).setTrashed(true);
  } catch (error) {
    // Ignore Drive cleanup failures so the message row can still be removed.
  }
}
