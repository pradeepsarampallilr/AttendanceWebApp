/** The configured anchor day's name, shared by every page that mentions it. */
import { createContext, useContext } from 'react';

export const AnchorDayContext = createContext('Anchor day');
export const useAnchorDay = () => useContext(AnchorDayContext);
