mod camera;
#[macro_use]
mod vector;
mod sphere;
pub use crate::{camera::*, sphere::*, vector::*};

pub type Color = Vector;
pub const BLACK: Color = Color::new(0.0, 0.0, 0.0);

pub fn write_color<W: std::io::Write>(writer: &mut W, color: Color) -> std::io::Result<()> {
    fn cast_pixel(v: f64) -> u8 {
        if v < 0.0 {
            0
        } else if v > 1.0 {
            255
        } else {
            (v.sqrt() * 255.999).floor() as u8
        }
    }
    writeln!(
        writer,
        "{} {} {}",
        cast_pixel(color.x()),
        cast_pixel(color.y()),
        cast_pixel(color.z()),
    )?;
    Ok(())
}

pub trait Hit {
    fn hit(&self, a: Vector, b: Vector) -> bool;
}
