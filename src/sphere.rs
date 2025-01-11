use crate::Vector;

#[derive(Debug, Clone)]
pub struct Sphere {
    pub center: Vector,
    pub radius: f64,
}

impl Sphere {
    pub const fn new(center: Vector, radius: f64) -> Sphere {
        Sphere { center, radius }
    }

    pub fn signed_distance(&self, p: Vector) -> f64 {
        (p - self.center).norm() - self.radius
    }
}
