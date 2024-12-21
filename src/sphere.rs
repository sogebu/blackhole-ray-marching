use crate::{Hit, Vector};

#[derive(Debug, Clone)]
pub struct Sphere {
    pub center: Vector,
    pub radius: f64,
}

impl Sphere {
    pub const fn new(center: Vector, radius: f64) -> Sphere {
        Sphere { center, radius }
    }
}

impl Hit for Sphere {
    fn hit(&self, a: Vector, b: Vector) -> bool {
        (b - self.center).norm_squared() <= self.radius * self.radius
            && (a - self.center).norm_squared() >= self.radius * self.radius
    }
}
