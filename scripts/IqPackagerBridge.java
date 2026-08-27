package com.atelier.tools;

import com.garmin.connectiq.common.devices.Device;
import com.garmin.connectiq.common.signing.KeyUtils;
import com.garmin.monkeybrains.compiler2.packager.IqPackager;
import com.garmin.monkeybrains.devices.DeviceManager;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.transform.Transformer;
import javax.xml.transform.TransformerFactory;
import javax.xml.transform.dom.DOMSource;
import javax.xml.transform.stream.StreamResult;
import java.io.File;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.PrivateKey;
import java.util.*;

/**
 * IqPackagerBridge
 *
 * Bridges parallel-compiled Connect IQ binaries (.prg, debug.xml, settings.json)
 * with Garmin's official SDK packager (monkeybrains.jar / IqPackager).
 */
public class IqPackagerBridge {

    public static void main(String[] args) {
        try {
            Map<String, String> params = parseArgs(args);

            String projectDir = requireParam(params, "projectDir");
            String manifestPath = requireParam(params, "manifest");
            String outputDir = requireParam(params, "outputDir");
            String keyPath = requireParam(params, "key");
            String devicesDir = requireParam(params, "devicesDir");
            String stageDir = requireParam(params, "stageDir");
            String appName = params.get("appName");

            File manifestFile = new File(manifestPath);
            if (!manifestFile.exists()) {
                throw new IllegalArgumentException("Manifest file not found: " + manifestPath);
            }

            File keyFile = new File(keyPath);
            if (!keyFile.exists()) {
                throw new IllegalArgumentException("Developer key not found: " + keyPath);
            }

            File devicesRoot = new File(devicesDir);
            if (!devicesRoot.exists()) {
                throw new IllegalArgumentException("Devices directory not found: " + devicesDir);
            }

            DeviceManager deviceManager = new DeviceManager(devicesRoot);
            PrivateKey privateKey = KeyUtils.getPrivateKey(keyFile);

            File stageDirectory = new File(stageDir);
            if (!stageDirectory.exists()) {
                stageDirectory.mkdirs();
            }

            // Parse Manifest XML
            DocumentBuilderFactory dbFactory = DocumentBuilderFactory.newInstance();
            DocumentBuilder dBuilder = dbFactory.newDocumentBuilder();
            Document doc = dBuilder.parse(manifestFile);

            if (appName == null || appName.trim().isEmpty()) {
                NodeList appNodes = doc.getElementsByTagName("iq:application");
                if (appNodes.getLength() > 0) {
                    Element appElement = (Element) appNodes.item(0);
                    appName = appElement.getAttribute("entry");
                    if (appName == null || appName.isEmpty()) {
                        appName = appElement.getAttribute("name");
                    }
                }
                if (appName == null || appName.isEmpty()) {
                    appName = new File(projectDir).getName();
                }
            }

            // Find compiled device directories in stageDir
            Set<String> compiledDeviceIds = new HashSet<>();
            File[] deviceDirs = stageDirectory.listFiles(File::isDirectory);
            if (deviceDirs != null) {
                for (File d : deviceDirs) {
                    if (!d.getName().startsWith("_")) {
                        compiledDeviceIds.add(d.getName());
                    }
                }
            }

            // Annotate manifest products with partNumber and remove uncompiled products
            NodeList productNodes = doc.getElementsByTagName("iq:product");
            List<Node> toRemove = new ArrayList<>();
            for (int i = 0; i < productNodes.getLength(); i++) {
                Element prodElement = (Element) productNodes.item(i);
                String deviceId = prodElement.getAttribute("id");
                if (!compiledDeviceIds.contains(deviceId)) {
                    toRemove.add(prodElement);
                    continue;
                }
                Device dev = deviceManager.getDevice(deviceId);
                if (dev != null && dev.getWorldwidePartNumber() != null) {
                    prodElement.setAttribute("partNumber", dev.getWorldwidePartNumber());
                }
            }
            for (Node n : toRemove) {
                n.getParentNode().removeChild(n);
            }

            // Write staged annotated manifest
            File packageStageDir = new File(stageDirectory, "_package_staging");
            if (!packageStageDir.exists()) {
                packageStageDir.mkdirs();
            }

            File stagedManifestFile = new File(packageStageDir, "manifest.xml");
            Transformer transformer = TransformerFactory.newInstance().newTransformer();
            transformer.transform(new DOMSource(doc), new StreamResult(stagedManifestFile));

            // Find all compiled device folders in stageDirectory
            List<IqPackager.AppFiles> appFilesList = new ArrayList<>();
            if (deviceDirs == null || deviceDirs.length == 0) {
                throw new IllegalStateException("No device build directories found in stageDir: " + stageDir);
            }

            System.out.println("Processing " + deviceDirs.length + " compiled device folders for app '" + appName + "'...");

            for (File devDir : deviceDirs) {
                if (devDir.getName().startsWith("_")) {
                    continue;
                }
                String deviceId = devDir.getName();
                Device device = deviceManager.getDevice(deviceId);
                if (device == null) {
                    System.err.println("Warning: Device '" + deviceId + "' not found in DeviceManager. Skipping.");
                    continue;
                }

                String partNumber = device.getWorldwidePartNumber();
                if (partNumber == null || partNumber.isEmpty()) {
                    System.err.println("Warning: Worldwide part number for '" + deviceId + "' not found. Skipping.");
                    continue;
                }

                // Find .prg file in devDir
                File[] prgCandidates = devDir.listFiles((dir, name) -> name.endsWith(".prg"));
                if (prgCandidates == null || prgCandidates.length == 0) {
                    System.err.println("Warning: No .prg found in " + devDir.getAbsolutePath() + ". Skipping.");
                    continue;
                }
                File srcPrg = prgCandidates[0];

                // Find debug.xml (or .prg.debug.xml)
                File srcDebug = null;
                File[] debugCandidates = devDir.listFiles((dir, name) -> name.endsWith("debug.xml"));
                if (debugCandidates != null && debugCandidates.length > 0) {
                    srcDebug = debugCandidates[0];
                }

                // Find settings.json (if any)
                File srcSettings = null;
                File[] settingsCandidates = devDir.listFiles((dir, name) -> name.endsWith("-settings.json") || name.endsWith("settings.json"));
                if (settingsCandidates != null && settingsCandidates.length > 0) {
                    srcSettings = settingsCandidates[0];
                }

                // Find fit.json (if any)
                File srcFit = null;
                File[] fitCandidates = devDir.listFiles((dir, name) -> name.endsWith("fit_contributions.json") || name.endsWith("fit.json"));
                if (fitCandidates != null && fitCandidates.length > 0) {
                    srcFit = fitCandidates[0];
                }

                // Prepare target files named with Garmin Part Number
                File targetPrg = new File(packageStageDir, partNumber + ".prg");
                Files.copy(srcPrg.toPath(), targetPrg.toPath(), StandardCopyOption.REPLACE_EXISTING);

                File targetDebug = null;
                if (srcDebug != null && srcDebug.exists()) {
                    targetDebug = new File(packageStageDir, partNumber + "-debug.xml");
                    Files.copy(srcDebug.toPath(), targetDebug.toPath(), StandardCopyOption.REPLACE_EXISTING);
                }

                File targetSettings = null;
                if (srcSettings != null && srcSettings.exists()) {
                    targetSettings = new File(packageStageDir, partNumber + "-settings.json");
                    Files.copy(srcSettings.toPath(), targetSettings.toPath(), StandardCopyOption.REPLACE_EXISTING);
                }

                File targetFit = null;
                if (srcFit != null && srcFit.exists()) {
                    targetFit = new File(packageStageDir, partNumber + "-fit_contributions.json");
                    Files.copy(srcFit.toPath(), targetFit.toPath(), StandardCopyOption.REPLACE_EXISTING);
                }

                IqPackager.AppFiles appFiles = new IqPackager.AppFiles(
                        targetPrg.getAbsolutePath(),
                        targetDebug != null ? targetDebug.getAbsolutePath() : null,
                        targetSettings != null ? targetSettings.getAbsolutePath() : null,
                        targetFit != null ? targetFit.getAbsolutePath() : null,
                        null,
                        null
                );

                appFilesList.add(appFiles);
            }

            if (appFilesList.isEmpty()) {
                throw new IllegalStateException("No valid AppFiles were prepared for packaging.");
            }

            IqPackager.AppFiles[] filesArray = appFilesList.toArray(new IqPackager.AppFiles[0]);

            System.out.println("Calling IqPackager.packageApp for " + filesArray.length + " target products...");
            long startTime = System.currentTimeMillis();

            File outDirFile = new File(outputDir);
            if (!outDirFile.exists()) {
                outDirFile.mkdirs();
            }

            List warnings = IqPackager.packageApp(
                    appName,
                    outputDir,
                    stagedManifestFile.getAbsolutePath(),
                    filesArray,
                    null,
                    privateKey,
                    deviceManager
            );

            long elapsed = System.currentTimeMillis() - startTime;
            File generatedIq = new File(outDirFile, appName + ".iq");
            System.out.println("Packaging completed successfully in " + elapsed + " ms.");
            System.out.println("Generated IQ: " + generatedIq.getAbsolutePath() + " (" + generatedIq.length() + " bytes)");

            if (warnings != null && !warnings.isEmpty()) {
                System.out.println("Warnings: " + warnings);
            }

            // Cleanup staging folder
            deleteDirectory(packageStageDir);

        } catch (Exception e) {
            System.err.println("Packaging failed: " + e.getMessage());
            e.printStackTrace();
            System.exit(1);
        }
    }

    private static Map<String, String> parseArgs(String[] args) {
        Map<String, String> map = new HashMap<>();
        for (int i = 0; i < args.length; i++) {
            if (args[i].startsWith("--") && i + 1 < args.length) {
                String key = args[i].substring(2);
                String val = args[++i];
                map.put(key, val);
            }
        }
        return map;
    }

    private static String requireParam(Map<String, String> params, String name) {
        String val = params.get(name);
        if (val == null || val.trim().isEmpty()) {
            throw new IllegalArgumentException("Missing required parameter: --" + name);
        }
        return val;
    }

    private static void deleteDirectory(File dir) {
        if (dir.isDirectory()) {
            File[] files = dir.listFiles();
            if (files != null) {
                for (File f : files) {
                    deleteDirectory(f);
                }
            }
        }
        dir.delete();
    }
}