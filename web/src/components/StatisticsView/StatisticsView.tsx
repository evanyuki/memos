import { useMemoFilterContext } from "@/contexts/MemoFilterContext";
import { useDateFilterNavigation } from "@/hooks";
import type { StatisticsData } from "@/types/statistics";
import { SidebarDateCalendar } from "./SidebarDateCalendar";

interface Props {
  statisticsData: StatisticsData;
  onDateSelect?: () => void;
  /** When set, day clicks land on this route with the date filter instead of filtering the current one. */
  navigationTarget?: string;
}

const StatisticsView = (props: Props) => {
  const { statisticsData } = props;
  const { activityStats, timeBasis } = statisticsData;
  const { filters } = useMemoFilterContext();
  const navigateToDateFilter = useDateFilterNavigation(props.navigationTarget);
  const selectedDate = filters.find((filter) => filter.factor === "displayTime")?.value;

  return (
    <SidebarDateCalendar
      data={activityStats}
      selectedDate={selectedDate}
      onDateSelect={(date) => {
        navigateToDateFilter(date);
        props.onDateSelect?.();
      }}
      timeBasis={timeBasis}
    />
  );
};

export default StatisticsView;
