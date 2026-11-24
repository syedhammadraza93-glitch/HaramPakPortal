import { Router } from "express";
import {
  changePackageStatus, createDeparture, createPackage, deleteBrochure, deleteDeparture, deleteImage, downloadBrochure, duplicatePackage,
  getPackage, getPriceHistory, listPackages, listSpecialPrices, saveAddons, saveHotels, saveItinerary, saveRates, saveSpecialPrices,
  setCoverImage, updateDeparture, updatePackage, uploadBrochure, uploadImages,
} from "../controllers/package.controller";
import { jwtGuard, requirePermission as can } from "../middleware/auth.middleware";
import { packageImagesUpload, singleDocumentUpload } from "../middleware/upload";
import { asyncHandler as h } from "../utils/http";

/** /api/admin/packages */
const router = Router();
router.use(jwtGuard);

router.get("/", can("catalogue.view"), h(listPackages));
router.post("/", can("catalogue.manage"), h(createPackage));
router.get("/:id", can("catalogue.view"), h(getPackage));
router.patch("/:id", can("catalogue.manage"), h(updatePackage));
router.post("/:id/status/:action", can("catalogue.manage"), h(changePackageStatus));
router.post("/:id/duplicate", can("catalogue.manage"), h(duplicatePackage));

router.put("/:id/hotels", can("catalogue.manage"), h(saveHotels));
router.put("/:id/itinerary", can("catalogue.manage"), h(saveItinerary));

router.post("/:id/departures", can("catalogue.manage"), h(createDeparture));
router.put("/:id/departures/:departureId", can("catalogue.manage"), h(updateDeparture));
router.delete("/:id/departures/:departureId", can("catalogue.manage"), h(deleteDeparture));

// Prices
router.put("/:id/rates", can("pricing.manage"), h(saveRates));
router.put("/:id/addons", can("pricing.manage"), h(saveAddons));
router.get("/:id/price-history", can("catalogue.view"), h(getPriceHistory));
router.get("/:id/special-prices", can("pricing.manage"), h(listSpecialPrices));
router.put("/:id/special-prices/:agencyId", can("pricing.manage"), h(saveSpecialPrices));

// Media
router.post("/:id/images", can("catalogue.manage"), packageImagesUpload, h(uploadImages));
router.delete("/:id/images/:imageId", can("catalogue.manage"), h(deleteImage));
router.post("/:id/images/:imageId/cover", can("catalogue.manage"), h(setCoverImage));
router.get("/:id/brochure", can("catalogue.view"), h(downloadBrochure));
router.post("/:id/brochure", can("catalogue.manage"), singleDocumentUpload, h(uploadBrochure));
router.delete("/:id/brochure", can("catalogue.manage"), h(deleteBrochure));

export default router;
