const SHEET_NAME = "messages";
const DRIVE_FOLDER_PROPERTY = "DRIVE_FOLDER_ID";
const SECRET_PROPERTY = "APP_SECRET";

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
  const createdAt = new Date().toISOString();
  const messageId = Utilities.getUuid();
  const text = String(payload.text || "").trim();
  let imageUrl = "";

  if (payload.type === "text") {
    requireValue(text, "text is required for text messages");
  } else if (payload.type === "image") {
    requireValue(payload.imageData, "imageData is required for image messages");
    imageUrl = saveImage(payload.imageData, payload.fileName, payload.mimeType, payload.roomId);
  } else {
    throw new Error("Unsupported type");
  }

  const row = [
    messageId,
    String(payload.roomId),
    String(payload.senderRole),
    String(payload.type),
    text,
    imageUrl,
    createdAt,
    String(payload.clientTimestamp || ""),
  ];

  sheet.appendRow(row);

  return {
    id: messageId,
    roomId: String(payload.roomId),
    senderRole: String(payload.senderRole),
    type: String(payload.type),
    text: text,
    imageUrl: imageUrl,
    createdAt: createdAt,
  };
}

function readMessages(roomId, since) {
  const sheet = getOrCreateSheet();
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) {
    return [];
  }

  const sinceTime = since ? new Date(since).getTime() : 0;
  return values
    .slice(1)
    .map(function (row) {
      return {
        id: row[0],
        roomId: row[1],
        senderRole: row[2],
        type: row[3],
        text: row[4],
        imageUrl: row[5],
        createdAt: row[6],
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
    sheet.appendRow([
      "id",
      "roomId",
      "senderRole",
      "type",
      "text",
      "imageUrl",
      "createdAt",
      "clientTimestamp",
    ]);
  }

  return sheet;
}

function saveImage(imageData, fileName, mimeType, roomId) {
  const folderId = PropertiesService.getScriptProperties().getProperty(DRIVE_FOLDER_PROPERTY);
  if (!folderId) {
    throw new Error("DRIVE_FOLDER_ID is not configured");
  }

  const folder = DriveApp.getFolderById(folderId);
  const cleanedFileName = fileName || "image.jpg";
  const bytes = Utilities.base64Decode(imageData.split(",")[1]);
  const blob = Utilities.newBlob(bytes, mimeType || "image/jpeg", roomId + "-" + cleanedFileName);
  const file = folder.createFile(blob);

  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return "https://drive.google.com/uc?export=view&id=" + file.getId();
}
