package tools;

import java.io.*;
import java.nio.file.Files;
import java.util.*;
import com.garmin.connectiq.common.communication.shell.*;
import com.garmin.connectiq.common.communication.channels.shell.*;
import com.garmin.connectiq.common.communication.channels.platform.*;
import com.garmin.connectiq.common.communication.channels.device.*;
import com.garmin.connectiq.common.communication.channels.app.*;
import com.garmin.connectiq.common.communication.channels.app.AppChannelManager.AppChannel;
import com.garmin.connectiq.common.communication.channels.utils.MessageUtilities;
import com.garmin.connectiq.common.prgreader.PrgReader;
import com.garmin.connectiq.common.prgreader.PrgReader.PrgSectionType;
import com.garmin.connectiq.common.prgreader.entrypoints.EntryPoints;

public class PortMonkeyDo implements IAppSubChannel, IAppChannelListener {
    private Process shellProcessRef = null;

    public static void main(String[] args) {
        if (args.length < 3) {
            System.err.println("Usage: java tools.PortMonkeyDo <port> <prgPath> <deviceId> [durationSec]");
            System.exit(1);
        }

        int durationSec = args.length >= 4 ? Integer.parseInt(args[3]) : 6;
        new PortMonkeyDo().execute(Integer.parseInt(args[0]), new File(args[1]), args[2], durationSec);
    }

    public void execute(int port, File prgFile, String deviceId, int durationSec) {
        try {
            String appData = System.getenv("APPDATA");
            File cfg = new File(appData, "Garmin/ConnectIQ/current-sdk.cfg");
            String sdkPath = new String(Files.readAllBytes(cfg.toPath())).trim();
            File shellExe = new File(sdkPath, "bin/shell.exe");

            ShellUtils.pushPrg(prgFile, shellExe, port);

            File debugXml = new File(prgFile.getParentFile(), prgFile.getName() + ".debug.xml");
            if (debugXml.exists()) {
                ShellUtils.pushFile(debugXml, "0:/GARMIN/Debug/" + debugXml.getName().toUpperCase(), shellExe, port);
            }

            UUID appUuid = null;
            try (DataInputStream dis = new DataInputStream(new FileInputStream(prgFile))) {
                PrgReader reader = new PrgReader(dis);
                reader.parse(Arrays.asList(PrgSectionType.ENTRY_POINTS, PrgSectionType.HEADER));
                EntryPoints ep = (EntryPoints) reader.getParsedSection(PrgSectionType.ENTRY_POINTS);
                if (ep != null && ep.getEntryPoints() != null && !ep.getEntryPoints().isEmpty()) {
                    appUuid = MessageUtilities.createUuidFromString(ep.getEntryPoints().get(0).getUuid());
                }
            }

            ArrayList<String> cmd = ShellUtils.getShellCommand(shellExe, port);
            Process p = Runtime.getRuntime().exec(cmd.toArray(new String[0]));
            shellProcessRef = p;

            Runtime.getRuntime().addShutdownHook(new Thread(() -> {
                if (shellProcessRef != null) {
                    shellProcessRef.destroyForcibly();
                }
            }));

            ShellProcess shellProc = new ShellProcess();
            shellProc.start(p);

            PlatformChannel pc = new PlatformChannel();
            DeviceChannel dc = new DeviceChannel();
            AppChannelManager acm = new AppChannelManager();
            ShellChannelManager scm = new ShellChannelManager();

            scm.setShellProcess(shellProc);
            scm.tune(pc);
            scm.tune(dc);
            scm.tune(acm);

            acm.tune(this);

            shellProc.sendMessage("ciq");
            Thread.sleep(500);

            pc.openDevice(deviceId);
            Thread.sleep(2000);

            if (appUuid != null) {
                dc.openApp(appUuid, false);
            }

            Thread.sleep(Math.max(1000, durationSec * 1000L));
            p.destroyForcibly();
            System.exit(0);
        } catch (Exception e) {
            e.printStackTrace();
            if (shellProcessRef != null) {
                shellProcessRef.destroyForcibly();
            }
            System.exit(1);
        }
    }

    @Override
    public AppChannel getAppChannel() {
        return AppChannel.DEFAULT;
    }

    @Override
    public void messageReceived(UUID appUuid, String message) {
        System.out.println(message);
        System.out.flush();
    }

    @Override
    public void messageReceived(String message) {
        System.out.println(message);
        System.out.flush();
    }

    @Override
    public void messageSent(String message) {}

    @Override
    public void messageFailedToSend(String message, Exception e) {}

    @Override
    public void exceptionOccurred(Exception e) {}

    @Override
    public void processExited(int exitCode) {}
}