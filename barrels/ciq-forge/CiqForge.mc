using Toybox.ActivityMonitor as Activity;
using Toybox.Application as App;
using Toybox.System as Sys;
using Toybox.Time as Time;

module CiqForge {
    const Version = "0.2.0";

    class ClockTime {
        var hour;
        var min;
        var sec;

        function initialize(hourValue, minuteValue, secondValue) {
            hour = hourValue;
            min = minuteValue;
            sec = secondValue;
        }
    }

    class ClockService {
        function now() { return null; }
        function getClockTime() { return null; }
    }

    class ProductionClock extends ClockService {
        function now() { return Time.now(); }
        function getClockTime() { return Sys.getClockTime(); }
    }

    class FixtureClock extends ClockService {
        private var _moment;
        private var _clockTime;

        function initialize(moment, clockTime) {
            _moment = moment;
            _clockTime = clockTime;
        }

        function now() { return _moment; }
        function getClockTime() { return _clockTime; }
    }

    class SystemService {
        function getBattery() { return null; }
        function getNotifications() { return null; }
    }

    class ProductionSystem extends SystemService {
        function getBattery() { return Sys.getSystemStats().battery; }
        function getNotifications() { return null; }
    }

    class FixtureSystem extends SystemService {
        private var _battery;
        private var _notifications;

        function initialize(battery, notifications) {
            _battery = battery;
            _notifications = notifications;
        }

        function getBattery() { return _battery; }
        function getNotifications() { return _notifications; }
    }

    class ActivityService {
        function getSteps() { return null; }
        function getStepGoal() { return null; }
        function getBodyBattery() { return null; }
        function getRecoveryHours() { return null; }
        function getIntensityMinutes() { return null; }
        function getWeeklyDistanceMeters() { return null; }
    }

    class ProductionActivity extends ActivityService {
        function getSteps() { return Activity.getInfo().steps; }
    }

    class FixtureActivity extends ActivityService {
        private var _steps;
        private var _stepGoal;
        private var _bodyBattery;
        private var _recoveryHours;
        private var _intensityMinutes;
        private var _weeklyDistanceMeters;

        function initialize(steps, stepGoal, bodyBattery, recoveryHours, intensityMinutes, weeklyDistanceMeters) {
            _steps = steps;
            _stepGoal = stepGoal;
            _bodyBattery = bodyBattery;
            _recoveryHours = recoveryHours;
            _intensityMinutes = intensityMinutes;
            _weeklyDistanceMeters = weeklyDistanceMeters;
        }

        function getSteps() { return _steps; }
        function getStepGoal() { return _stepGoal; }
        function getBodyBattery() { return _bodyBattery; }
        function getRecoveryHours() { return _recoveryHours; }
        function getIntensityMinutes() { return _intensityMinutes; }
        function getWeeklyDistanceMeters() { return _weeklyDistanceMeters; }
    }

    class WeatherService {
        function getTemperatureCelsius() { return null; }
        function getCondition() { return null; }
    }

    class ProductionWeather extends WeatherService {}

    class FixtureWeather extends WeatherService {
        private var _temperature;
        private var _condition;

        function initialize(temperature, condition) {
            _temperature = temperature;
            _condition = condition;
        }

        function getTemperatureCelsius() { return _temperature; }
        function getCondition() { return _condition; }
    }

    class SettingsService {
        function getValue(key, defaultValue) { return defaultValue; }
    }

    class ProductionSettings extends SettingsService {
        function getValue(key, defaultValue) {
            var value = App.Properties.getValue(key);
            return value == null ? defaultValue : value;
        }
    }

    class FixtureSettings extends SettingsService {
        private var _values;

        function initialize(values) { _values = values; }

        function getValue(key, defaultValue) {
            return _values.hasKey(key) ? _values[key] : defaultValue;
        }
    }

    class DisplayModeService {
        function isLowPower() { return false; }
    }

    class FixtureDisplayMode extends DisplayModeService {
        private var _lowPower;
        function initialize(lowPower) { _lowPower = lowPower; }
        function isLowPower() { return _lowPower; }
    }

    class Diagnostics {
        private var _runId;
        private var _renderStartedAt;
        private var _profilingEnabled;

        function initialize(runId, profilingEnabled) {
            _runId = runId;
            _renderStartedAt = null;
            _profilingEnabled = profilingEnabled;
        }

        function emit(eventName, payload) {
            Sys.println("CIQ_FORGE_EVENT|1|" + _runId + "|" + eventName + "|" + payload);
        }

        function recordStats(checkpoint) {
            var stats = Sys.getSystemStats();
            emit(
                "runtime.stats",
                "checkpoint=" + checkpoint +
                ";usedMemory=" + stats.usedMemory +
                ";freeMemory=" + stats.freeMemory +
                ";totalMemory=" + stats.totalMemory +
                ";battery=" + stats.battery +
                ";timerMs=" + Sys.getTimer()
            );
        }

        function record(eventName, payload) {
            emit(eventName, payload);
            if (_profilingEnabled) {
                recordStats(eventName);
            }
        }

        function beginRender() {
            if (_profilingEnabled) {
                emit("render.start", "ok");
                _renderStartedAt = Sys.getTimer();
            }
        }

        function endRender() {
            if (_profilingEnabled && _renderStartedAt != null) {
                var finishedAt = Sys.getTimer();
                emit("render.sample", "durationMs=" + (finishedAt - _renderStartedAt));
            }
            _renderStartedAt = null;
            record("render.complete", "ok");
        }

        function assertResult(name, passed, message) {
            record("assert", name + ";" + (passed ? "passed" : "failed") + ";" + message);
        }
    }

    class RuntimeContext {
        var clock;
        var systemService;
        var activity;
        var weather;
        var settings;
        var displayMode;
        var diagnostics;

        function initialize(clockProvider, systemProvider, activityProvider, weatherProvider, settingsProvider, displayModeProvider, diagnosticsProvider) {
            clock = clockProvider;
            systemService = systemProvider;
            activity = activityProvider;
            weather = weatherProvider;
            settings = settingsProvider;
            displayMode = displayModeProvider;
            diagnostics = diagnosticsProvider;
        }
    }

    function productionContext() {
        return new RuntimeContext(
            new ProductionClock(),
            new ProductionSystem(),
            new ProductionActivity(),
            new ProductionWeather(),
            new ProductionSettings(),
            new DisplayModeService(),
            new Diagnostics("production", false)
        );
    }
}
