import { Capacitor } from '@capacitor/core';
import { planToICS, type CalendarPlan } from './calendar';

export async function exportCalendarPlan(plan: CalendarPlan): Promise<void> {
  const contents = planToICS(plan);
  if (Capacitor.isNativePlatform()) {
    const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
    const path = `goodeats-plan-${plan.id}.ics`;
    const file = await Filesystem.writeFile({ path, directory: Directory.Cache, data: contents, encoding: Encoding.UTF8 });
    try { await Share.share({ title: plan.title, files: [file.uri], dialogTitle: 'Export your plan' }); }
    catch (error) { if (!(error instanceof Error && /cancel/i.test(error.message))) throw error; }
    finally { await Filesystem.deleteFile({ path, directory: Directory.Cache }).catch(() => {}); }
    return;
  }
  const url = URL.createObjectURL(new Blob([contents], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = 'goodeats-plan.ics'; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
