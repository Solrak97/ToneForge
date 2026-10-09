use crate::error::DeviceError;
use toneforge_core::Patch;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DeviceInfo {
    pub id: String,
    pub name: String,
    pub manufacturer_hint: Option<String>,
    pub model_hint: Option<String>,
}

pub trait DeviceDriver: Send {
    fn list_devices(&self) -> Result<Vec<DeviceInfo>, DeviceError>;

    fn connect(&mut self, device_id: &str) -> Result<(), DeviceError>;

    fn disconnect(&mut self) -> Result<(), DeviceError>;

    fn is_connected(&self) -> bool;

    fn enter_editor_mode(&mut self) -> Result<(), DeviceError>;

    fn read_current_patch(&mut self) -> Result<Patch, DeviceError>;

    fn read_param(&mut self, param_id: &str) -> Result<i32, DeviceError>;

    fn write_param(&mut self, param_id: &str, value: i32) -> Result<(), DeviceError>;

    fn read_current_channel(&mut self) -> Result<u8, DeviceError>;

    fn select_channel(&mut self, channel: u8) -> Result<(), DeviceError>;

    fn device_model(&self) -> &str;
}

pub struct DeviceSession<D: DeviceDriver> {
    driver: D,
}

impl<D: DeviceDriver> DeviceSession<D> {
    pub fn new(driver: D) -> Self {
        Self { driver }
    }

    pub fn driver(&self) -> &D {
        &self.driver
    }

    pub fn driver_mut(&mut self) -> &mut D {
        &mut self.driver
    }
}
