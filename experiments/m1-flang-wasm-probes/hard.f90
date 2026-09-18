module shapes
  implicit none
  private
  public :: shape_t, circle_t, box_t, make_label

  type, abstract :: shape_t
    character(len=:), allocatable :: name
    real, allocatable :: params(:)
  contains
    procedure(area_i), deferred :: area
    procedure :: describe
  end type shape_t

  abstract interface
    pure function area_i(self) result(a)
      import :: shape_t
      class(shape_t), intent(in) :: self
      real :: a
    end function area_i
  end interface

  type, extends(shape_t) :: circle_t
  contains
    procedure :: area => circle_area
  end type circle_t

  type, extends(shape_t) :: box_t
  contains
    procedure :: area => box_area
  end type box_t

contains

  pure function circle_area(self) result(a)
    class(circle_t), intent(in) :: self
    real :: a
    a = 3.14159265358979323846_8 * self%params(1) * self%params(1)
  end function circle_area

  pure function box_area(self) result(a)
    class(box_t), intent(in) :: self
    real :: a
    a = self%params(1) * self%params(2)
  end function box_area

  subroutine describe(self)
    class(shape_t), intent(in) :: self
    select type (s => self)
    type is (circle_t)
      write(*,'(a,a,a,f20.14)') "circle  <", s%name, ">  area=", s%area()
    type is (box_t)
      write(*,'(a,a,a,f20.14)') "box     <", s%name, ">  area=", s%area()
    class default
      error stop "unknown shape subclass"
    end select
  end subroutine describe

  function make_label(prefix, n) result(lbl)
    character(len=*), intent(in) :: prefix
    integer, intent(in) :: n
    character(len=:), allocatable :: lbl
    character(len=32) :: buf
    write(buf,'(i0)') n
    lbl = trim(prefix) // "-" // trim(buf)
  end function make_label

end module shapes

program hard
  use shapes
  use, intrinsic :: iso_fortran_env, only: real64, int64, output_unit
  implicit none

  class(shape_t), allocatable :: s
  real(real64) :: acc
  integer(int64) :: i
  integer :: ios
  character(len=:), allocatable :: msg

  print '(a,i0)', "default real kind  = ", kind(1.0)
  print '(a,i0)', "default dble kind  = ", kind(1.0d0)
  print '(a,i0)', "real64 kind        = ", real64

  allocate(circle_t :: s)
  s%name = make_label("unit", 1)
  s%params = [2.0]
  call s%describe()
  deallocate(s)

  allocate(box_t :: s)
  s%name = make_label("rect", 42)
  s%params = [3.0, 4.5]
  call s%describe()
  deallocate(s)

  acc = 0.0_real64
  do i = 1_int64, 2000000_int64
    acc = acc + 1.0_real64/real(i,real64)**2
  end do
  write(output_unit,'(a,es24.16)') "sum 1/i^2 (2e6 terms) = ", acc
  write(output_unit,'(a,es24.16)') "pi^2/6                = ", &
       (4.0_real64*atan(1.0_real64))**2/6.0_real64

  ! file I/O round trip
  open(unit=17, file="scratch_test.txt", status="replace", action="write", iostat=ios)
  if (ios /= 0) error stop "cannot open file for write"
  write(17,'(a)') "roundtrip-ok"
  close(17)
  allocate(character(len=64) :: msg)
  open(unit=17, file="scratch_test.txt", status="old", action="read")
  read(17,'(a)') msg
  close(17)
  print '(a,a)', "file readback: ", trim(msg)

  print '(a)', "ALL-HARD-TESTS-PASSED"
end program hard
