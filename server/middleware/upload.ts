import multer from "multer";
import { MAX_UPLOAD_BYTES } from "../utils/files";
import { FILE_FIELDS, MAX_OTHER_DOCS, OTHER_DOCS_FIELD } from "../utils/registrationFields";

/** Files are kept in memory, type-checked by their content, then written to private storage. */
const memory = multer.memoryStorage();

/** Sign-up form: one file per configurable document field plus up to 3 other documents. */
export const registrationUpload = multer({
  storage: memory,
  limits: { fileSize: MAX_UPLOAD_BYTES, files: FILE_FIELDS.length + MAX_OTHER_DOCS, fields: 40 },
}).fields([...FILE_FIELDS.map((f) => ({ name: f.field, maxCount: 1 })), { name: OTHER_DOCS_FIELD, maxCount: MAX_OTHER_DOCS }]);

/** Single document upload (field name "file"). */
export const singleDocumentUpload = multer({ storage: memory, limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5 } }).single("file");

/** Package images: up to 10 per request (field name "files"). */
export const packageImagesUpload = multer({ storage: memory, limits: { fileSize: MAX_UPLOAD_BYTES, files: 10, fields: 5 } }).array("files", 10);

/** Payment receipts: up to 3 per request (field name "files"). */
export const paymentReceiptsUpload = multer({ storage: memory, limits: { fileSize: MAX_UPLOAD_BYTES, files: 3, fields: 15 } }).array("files", 3);
