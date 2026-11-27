/*! Local settings for the standalone booking app.
 *  Edit this file before use. Do not commit real secrets to a public repo.
 */
window.ZH_BOOKING_CONFIG = {
  /** Staff PIN (required to open the app) */
  pin: "000000",

  /** Digits only, country code included, e.g. "374XXXXXXXX". Empty = WhatsApp staff fallback disabled */
  staffWhatsApp: "",

  /** Shown on printed / shared booking documents */
  hotelName: "Kennel Booking",
  place: "",
  phoneDisplay: ""
};
