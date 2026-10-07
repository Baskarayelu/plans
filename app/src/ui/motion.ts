import { Platform } from "react-native";

/** The web app has no motion at all (design 101): no transitions, count-ups, spinners or pulses. */
export const NO_MOTION = Platform.OS === "web";
