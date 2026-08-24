import dayjs from "dayjs";
import { useEffect, useState } from "react";
import { calculateMaxCount, MonthCalendar } from "@/components/ActivityCalendar";
import type { MemoTimeBasis } from "@/contexts/ViewContext";
import { MonthNavigator } from "./MonthNavigator";

interface SidebarDateCalendarProps {
  data?: Record<string, number>;
  onDateSelect: (date: string) => void;
  selectedDate?: string;
  timeBasis?: MemoTimeBasis;
}

const EMPTY_DATE_COUNTS: Record<string, number> = {};

export const SidebarDateCalendar = ({ data = EMPTY_DATE_COUNTS, onDateSelect, selectedDate, timeBasis }: SidebarDateCalendarProps) => {
  const selectedMonth = selectedDate?.slice(0, 7);
  const [visibleMonth, setVisibleMonth] = useState(selectedMonth ?? dayjs().format("YYYY-MM"));

  useEffect(() => {
    if (selectedMonth) setVisibleMonth(selectedMonth);
  }, [selectedMonth]);

  return (
    <div className="group flex w-full flex-col text-muted-foreground animate-fade-in">
      <MonthNavigator visibleMonth={visibleMonth} onMonthChange={setVisibleMonth} />
      <div className="w-full animate-scale-in">
        <MonthCalendar
          month={visibleMonth}
          data={data}
          maxCount={calculateMaxCount(data)}
          selectedDate={selectedDate}
          onClick={onDateSelect}
          timeBasis={timeBasis}
        />
      </div>
    </div>
  );
};
