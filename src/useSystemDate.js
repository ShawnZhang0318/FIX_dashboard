import { useEffect, useState } from 'react';
import { localToday, observeSystemDate } from '../frontend/daily-data.js';

export function useSystemDate() {
  const [date, setDate] = useState(localToday);
  useEffect(() => observeSystemDate(setDate), []);
  return date;
}
