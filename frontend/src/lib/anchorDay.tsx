/** The anchor day's name (Wednesday by default) as configured, shared by every page that mentions it. */
import { createContext, useContext } from 'react';

export const AnchorDayContext = createContext('Wednesday');
export const useAnchorDay = () => useContext(AnchorDayContext);
